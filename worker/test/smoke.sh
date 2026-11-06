#!/usr/bin/env bash
#
# End-to-end smoke test for the My Recipes Worker.
# Starts a local `wrangler dev` (Miniflare, no Cloudflare login), runs HTTP
# assertions, prints PASS/FAIL, and always kills the server on exit.
#
set -u

cd "$(dirname "$0")/.." || exit 2

PORT="${PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/myrecipes-smoke.XXXXXX")"
LOG="$TMP/wrangler.log"
STATE="$TMP/state"
SERVER_PID=""
USE_SETSID=0
STATUS=""
PASSED=0
FAILED=0

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    if [ "$USE_SETSID" -eq 1 ]; then
      # setsid put wrangler and its workerd children in one process group.
      # Send the group signal even if the wrangler PID already exited, so an
      # orphaned workerd cannot keep the port open.
      kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
    elif kill -0 "$SERVER_PID" 2>/dev/null; then
      kill -TERM "$SERVER_PID" 2>/dev/null || true
      if command -v pkill >/dev/null 2>&1; then
        pkill -P "$SERVER_PID" 2>/dev/null || true
      fi
    fi
    sleep 0.2
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      if [ "$USE_SETSID" -eq 1 ]; then
        kill -KILL -- "-$SERVER_PID" 2>/dev/null || true
      else
        kill -KILL "$SERVER_PID" 2>/dev/null || true
      fi
    fi
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fail() {
  FAILED=$((FAILED + 1))
  printf '  FAIL %s\n' "$1"
}

pass() {
  PASSED=$((PASSED + 1))
  printf '  ok   %s\n' "$1"
}

check_status() {
  local name="$1" want="$2"
  if [ "$STATUS" = "$want" ]; then
    pass "$name"
  else
    fail "$name (want $want, got ${STATUS:-no response})"
  fi
}

check_eq() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    pass "$name"
  else
    fail "$name (want '$want', got '${got:-<empty>}')"
  fi
}

check_regex() {
  local name="$1" pattern="$2" got="$3"
  if [[ "$got" =~ $pattern ]]; then
    pass "$name"
  else
    fail "$name (got '${got:-<empty>}')"
  fi
}

check_body_contains() {
  local name="$1" needle="$2"
  if grep -Fq -- "$needle" "$TMP/body"; then
    pass "$name"
  else
    fail "$name (body missing: $needle)"
  fi
}

check_body_not_contains() {
  local name="$1" needle="$2"
  if grep -Fq -- "$needle" "$TMP/body"; then
    fail "$name (body unexpectedly contains: $needle)"
  else
    pass "$name"
  fi
}

header_value() {
  awk -v key="$1" '
    BEGIN { IGNORECASE = 1 }
    index(tolower($0), tolower(key) ":") == 1 {
      sub(/^[^:]*:[ \t]*/, "");
      sub(/\r$/, "");
      print;
      exit;
    }
  ' "$TMP/headers"
}

check_header_contains() {
  local name="$1" header="$2" needle="$3"
  local value
  value="$(header_value "$header")"
  if [ -n "$value" ] && [[ "$value" == *"$needle"* ]]; then
    pass "$name"
  else
    fail "$name (header $header: '${value:-<missing>}')"
  fi
}

request() {
  local method="$1" url="$2"
  shift 2
  curl -sS --max-time 30 -H 'Expect:' -X "$method" \
    -D "$TMP/headers" -o "$TMP/body" -w '%{http_code}' \
    "$@" "$url" 2>"$TMP/curl.err" || true
}

json_get() {
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let value = data;
    for (const part of process.argv[2].split(".")) {
      value = value == null ? undefined : value[part];
    }
    if (value === undefined) process.exit(1);
    process.stdout.write(String(value));
  ' "$TMP/body" "$1" 2>/dev/null
}

make_payload() {
  local out="$1" title="$2" body="$3" sender="$4"
  node -e '
    const fs = require("fs");
    const [out, title, body, sender] = process.argv.slice(1);
    fs.writeFileSync(out, JSON.stringify({ title, body, sender }));
  ' "$out" "$title" "$body" "$sender"
}

# Same as make_payload, plus a raw JSON `senderSeal` value.
make_seal_payload() {
  local out="$1" title="$2" body="$3" sender="$4" seal="$5"
  SEAL_JSON="$seal" node -e '
    const fs = require("fs");
    const [out, title, body, sender] = process.argv.slice(1);
    const senderSeal = JSON.parse(process.env.SEAL_JSON);
    fs.writeFileSync(out, JSON.stringify({ title, body, sender, senderSeal }));
  ' "$out" "$title" "$body" "$sender"
}

command -v curl >/dev/null 2>&1 || {
  echo "curl is required" >&2
  exit 2
}
command -v node >/dev/null 2>&1 || {
  echo "node is required" >&2
  exit 2
}
command -v npx >/dev/null 2>&1 || {
  echo "npx is required (run npm install first)" >&2
  exit 2
}

APP_KEY_VALUE="${APP_KEY:-}"
if [ -z "$APP_KEY_VALUE" ] && [ -f .dev.vars ]; then
  APP_KEY_VALUE="$(sed -n 's/^APP_KEY=//p' .dev.vars | head -n 1 | sed -e 's/^"//' -e 's/"$//')"
fi
APP_KEY_VALUE="${APP_KEY_VALUE:-dev-only-change-me}"

echo "Starting wrangler dev on ${BASE} (local Miniflare state) ..."
if command -v setsid >/dev/null 2>&1; then
  USE_SETSID=1
  setsid env CI=1 WRANGLER_SEND_METRICS=false npx --no-install wrangler dev \
    --port "$PORT" \
    --ip 127.0.0.1 \
    --persist-to "$STATE" \
    --var ASSETLINKS_JSON:[] \
    --var APK_URL: \
    --var VERSION_JSON:{"versionCode":1,"versionName":"1.0.0","url":"","notes":""} \
    >"$LOG" 2>&1 &
else
  CI=1 WRANGLER_SEND_METRICS=false npx --no-install wrangler dev \
    --port "$PORT" \
    --ip 127.0.0.1 \
    --persist-to "$STATE" \
    --var ASSETLINKS_JSON:[] \
    --var APK_URL: \
    --var VERSION_JSON:{"versionCode":1,"versionName":"1.0.0","url":"","notes":""} \
    >"$LOG" 2>&1 &
fi
SERVER_PID=$!

ready=0
for _ in $(seq 1 160); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "wrangler dev exited before becoming ready:" >&2
    tail -n 80 "$LOG" >&2
    exit 1
  fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    ready=1
    break
  fi
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "Server did not become ready at $BASE" >&2
  tail -n 80 "$LOG" >&2
  exit 1
fi

echo
echo "== Auth and create =="

make_payload "$TMP/basic.json" "GUIA: COMO PREPARAR FEIJÃO" \
  "$(printf '%s\n' \
    '1. Coloque 1 batata grande.' \
    '2. Lave o feijão.' \
    '3. Deixe de molho.' \
    '4. Refogue o alho.' \
    '5. Acrescente o feijão.' \
    '6. Cubra com água.' \
    '7. Cozinhe na pressão.' \
    '8. Espere a pressão sair.' \
    '9. Tempere com sal.' \
    '10. Sirva com arroz.' \
    '11. Guarde o restante.' \
    '12. Seja feliz.')" \
  "Lucas"

STATUS="$(request POST "$BASE/api/recipes" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/basic.json")"
check_status "POST without X-App-Key -> 401" 401
check_body_contains "401 body is unauthorized" '"error":"unauthorized"'

STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/basic.json")"
check_status "POST with X-App-Key -> 201" 201
check_header_contains "create response is JSON" 'content-type' 'application/json'

ID="$(json_get id)"
URL="$(json_get url)"
check_regex "returned id is 12 chars from the safe alphabet" \
  '^[abcdefghjkmnpqrstuvwxyz23456789]{12}$' "$ID"
# `wrangler dev` simulates the configured custom-domain route, so the Worker
# reports the production host as the request origin even locally.
ORIGIN="${URL%/r/$ID}"
if [ -z "$ORIGIN" ] || [ "$ORIGIN" = "$URL" ]; then ORIGIN="$BASE"; fi
check_eq "returned url shape" "$ORIGIN/r/$ID" "$URL"

echo
echo "== Stored JSON =="

STATUS="$(request GET "$BASE/api/recipes/$ID")"
check_status "GET recipe JSON -> 200" 200
check_header_contains "JSON is no-store" 'cache-control' 'no-store'
check_eq "stored id" "$ID" "$(json_get id)"
check_eq "stored version" "1" "$(json_get v)"
check_eq "stored title" "GUIA: COMO PREPARAR FEIJÃO" "$(json_get title)"
check_eq "server computed stepCount" "12" "$(json_get stepCount)"
check_eq "stored sender" "Lucas" "$(json_get sender)"
check_eq "no tags field in payload" "" "$(json_get tags)"

echo
echo "== In-place update =="

make_payload "$TMP/put-base.json" "Título original" \
  "$(printf '%s\n' \
    '1. Primeiro passo.' \
    '2. Segundo passo.')" \
  "Ana"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/put-base.json")"
check_status "PUT fixture create -> 201" 201
PUT_ID="$(json_get id)"
PUT_URL="$(json_get url)"

STATUS="$(request GET "$BASE/api/recipes/$PUT_ID")"
check_status "PUT fixture GET -> 200" 200
PUT_CREATED_AT="$(json_get createdAt)"
check_eq "fixture starts with 2 steps" "2" "$(json_get stepCount)"

make_payload "$TMP/put-update.json" "Título atualizado" \
  "$(printf '%s\n' \
    '1. Passo novo um.' \
    '2. Passo novo dois.' \
    '3. Passo novo três.' \
    'Texto SEGREDO-ATUALIZADO.')" \
  "Bia"
STATUS="$(request PUT "$BASE/api/recipes/$PUT_ID" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/put-update.json")"
check_status "PUT with X-App-Key -> 200" 200
check_eq "PUT keeps the same id" "$PUT_ID" "$(json_get id)"
check_eq "PUT keeps the same URL" "$PUT_URL" "$(json_get url)"

STATUS="$(request GET "$BASE/api/recipes/$PUT_ID")"
check_status "GET after PUT -> 200" 200
check_eq "updated title served" "Título atualizado" "$(json_get title)"
check_body_contains "updated body served" 'SEGREDO-ATUALIZADO'
check_eq "stepCount recomputed on update" "3" "$(json_get stepCount)"
check_eq "sender updated" "Bia" "$(json_get sender)"
check_eq "createdAt preserved across PUT" "$PUT_CREATED_AT" "$(json_get createdAt)"
check_eq "version preserved across PUT" "1" "$(json_get v)"

STATUS="$(request PUT "$BASE/api/recipes/$PUT_ID" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/put-update.json")"
check_status "PUT without X-App-Key -> 401" 401
check_body_contains "PUT 401 body is unauthorized" '"error":"unauthorized"'

STATUS="$(request PUT "$BASE/api/recipes/zzzzzzzzzzzz" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/put-update.json")"
check_status "PUT unknown id -> 404" 404
check_body_contains "PUT unknown id is not_found" '"error":"not_found"'

node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    title: "Grande demais",
    body: "x".repeat(70000),
    sender: "Ana"
  }));
' "$TMP/put-big.json"
STATUS="$(request PUT "$BASE/api/recipes/$PUT_ID" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/put-big.json")"
check_status "PUT body over 64 KiB -> 413" 413
check_body_contains "PUT 413 body is too_large" '"error":"too_large"'

printf '%s' '{"body":"1. Um passo."}' >"$TMP/put-notitle.json"
STATUS="$(request PUT "$BASE/api/recipes/$PUT_ID" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/put-notitle.json")"
check_status "PUT missing title -> 400" 400
check_body_contains "PUT 400 body is invalid" '"error":"invalid"'

STATUS="$(request DELETE "$BASE/api/recipes/$PUT_ID" \
  -H "X-App-Key: $APP_KEY_VALUE")"
check_status "DELETE before PUT -> 204" 204
STATUS="$(request PUT "$BASE/api/recipes/$PUT_ID" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/put-update.json")"
check_status "PUT after DELETE -> 410" 410
check_body_contains "PUT after DELETE body is revoked" '"error":"revoked"'

echo
echo "== Share page =="

STATUS="$(request GET "$BASE/r/$ID")"
check_status "GET share page -> 200" 200
check_header_contains "share page is HTML" 'content-type' 'text/html'
check_header_contains "CSP present" 'content-security-policy' "default-src 'none'"
check_header_contains "CSP script-src is self only" 'content-security-policy' "script-src 'self'"
check_header_contains "noindex header" 'x-robots-tag' 'noindex'
check_header_contains "share page cache policy" 'cache-control' 'private, max-age=300'
HEAD_CODE="$(curl -sS --max-time 30 --head -o /dev/null -w '%{http_code}' "$BASE/r/$ID" || true)"
check_eq "HEAD share page -> 200" 200 "$HEAD_CODE"
check_body_contains "og:title present" 'property="og:title"'
check_body_contains "og:title has recipe title" 'content="GUIA: COMO PREPARAR FEIJÃO"'
check_body_contains "og:description mentions passos" 'passos'
check_body_contains "og:description mentions sender" 'por Lucas'
check_body_contains "title element present" '<title>GUIA: COMO PREPARAR FEIJÃO</title>'
check_body_contains "canonical og:url present" "content=\"$ORIGIN/r/$ID\""
check_body_not_contains "no automatic meta refresh" 'http-equiv="refresh"'
check_body_not_contains "no APK link while APK_URL is unset" '/app/latest.apk'
check_body_contains "copy button present" 'data-copy='
check_body_contains "parchment action bar present" 'class="action-bar"'
check_body_contains "share primary label is Copiar receita" 'Copiar receita</button>'

if node - "$TMP/body" <<'NODE'
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const tags = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)];
if (tags.length !== 1) {
  console.error(`expected exactly one script element, got ${tags.length}`);
  process.exit(1);
}
const tag = tags[0][0];
if (!/^<script\s+src="\/assets\/page\.js"(?:\s+defer)?><\/script>$/.test(tag)) {
  console.error(`unexpected script element: ${tag}`);
  process.exit(2);
}
NODE
then
  pass "only script is /assets/page.js (no inline script)"
else
  fail "inline script or unexpected script element found"
fi

if node - "$TMP/body" <<'NODE'
const fs = require("fs");
let html = fs.readFileSync(process.argv[2], "utf8");
// The canonical and og:url tags are the only allowed http(s) references.
html = html
  .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, "")
  .replace(/<meta\b[^>]*property="og:url"[^>]*>/gi, "")
  .replace(/intent:\/\/[^"]*/gi, "");
const matches = html.match(/https?:\/\//gi) || [];
if (matches.length) {
  console.error(`unexpected external reference(s): ${matches.join(", ")}`);
  process.exit(1);
}
NODE
then
  pass "no external http(s) resources in share page"
else
  fail "share page references an external http(s) resource"
fi

echo
echo "== Share page — Android UA =="

STATUS="$(request GET "$BASE/r/$ID" \
  -A 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36')"
check_status "GET share page with Android UA -> 200" 200
check_body_contains "Android primary action is Abrir no app" 'Abrir no app</a>'
check_body_contains "Android action bar uses the intent URL" 'intent://'
check_body_contains "Android intent targets the app package" 'package=com.lunnaboo.myrecipes'
check_body_contains "Android intent keeps the https fallback" 'browser_fallback_url='
check_body_contains "Android copy action is still present" 'Copiar receita</button>'

echo
echo "== Sender seals =="

# A 1x1 transparent PNG; the server only checks the magic number.
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
SVG_B64="$(node -e '
  process.stdout.write(Buffer.from(process.argv[1], "utf8").toString("base64"));
' '<svg xmlns="http://www.w3.org/2000/svg"></svg>')"

make_seal_payload "$TMP/seal-owl.json" "Receita com selo" "1. Um passo." "Ana" \
  '{"kind":"sigil","id":"owl"}'
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-owl.json")"
check_status "POST sigil owl -> 201" 201
SEAL_ID="$(json_get id)"

STATUS="$(request GET "$BASE/api/recipes/$SEAL_ID")"
check_status "GET sigil recipe -> 200" 200
check_eq "stored seal kind" "sigil" "$(json_get senderSeal.kind)"
check_eq "stored seal id" "owl" "$(json_get senderSeal.id)"

STATUS="$(request GET "$BASE/r/$SEAL_ID")"
check_status "GET sigil share page -> 200" 200
check_body_contains "page renders the owl sigil hook" 'data-seal="owl"'

make_seal_payload "$TMP/seal-sea.json" "Receita com selo novo" "1. Um passo." "Ana" \
  '{"kind":"sigil","id":"sea"}'
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-sea.json")"
check_status "POST sigil sea -> 201" 201
STAMP_ID="$(json_get id)"

STATUS="$(request GET "$BASE/r/$STAMP_ID")"
check_status "GET sea share page -> 200" 200
check_body_contains "page renders the sea stamp hook" 'data-seal="sea"'
check_body_contains "page inlines the sea stamp as webp art" 'class="seal-stamp" src="data:image/webp'

STATUS="$(request GET "$BASE/r/$ID")"
check_body_contains "recipe without a seal falls back to the default hook" 'data-seal="default"'

make_seal_payload "$TMP/seal-unknown.json" "Selo inválido" "1. Um passo." "Ana" \
  '{"kind":"sigil","id":"dragon"}'
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-unknown.json")"
check_status "POST unknown sigil id -> 400" 400
check_body_contains "unknown sigil body is invalid" '"error":"invalid"'

SEAL_PNG="$(printf '{"kind":"image","mime":"image/png","data":"%s"}' "$PNG_B64")"
make_seal_payload "$TMP/seal-png.json" "Receita com foto" "1. Um passo." "Ana" "$SEAL_PNG"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-png.json")"
check_status "POST tiny PNG seal -> 201" 201
PNG_ID="$(json_get id)"

STATUS="$(request GET "$BASE/api/recipes/$PNG_ID")"
check_status "GET PNG seal recipe -> 200" 200
check_eq "stored PNG seal kind" "image" "$(json_get senderSeal.kind)"
check_eq "stored PNG seal mime" "image/png" "$(json_get senderSeal.mime)"

STATUS="$(request GET "$BASE/r/$PNG_ID")"
check_status "GET PNG share page -> 200" 200
check_body_contains "page renders a PNG data URI" 'data:image/png'
check_body_contains "page marks the image seal hook" 'data-seal="image"'

SEAL_SVG="$(printf '{"kind":"image","mime":"image/svg+xml","data":"%s"}' "$SVG_B64")"
make_seal_payload "$TMP/seal-svg.json" "Selo SVG" "1. Um passo." "Ana" "$SEAL_SVG"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-svg.json")"
check_status "POST SVG seal -> 400" 400
check_body_contains "SVG seal body is invalid" '"error":"invalid"'

# PNG bytes declared as JPEG: valid base64, wrong magic number.
SEAL_MISMATCH="$(printf '{"kind":"image","mime":"image/jpeg","data":"%s"}' "$PNG_B64")"
make_seal_payload "$TMP/seal-mismatch.json" "Selo trocado" "1. Um passo." "Ana" "$SEAL_MISMATCH"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-mismatch.json")"
check_status "POST mime/magic mismatch -> 400" 400
check_body_contains "mismatch body is invalid" '"error":"invalid"'

BIG_B64="$(node -e '
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const buf = Buffer.alloc(33000);
  png.copy(buf);
  process.stdout.write(buf.toString("base64"));
')"
SEAL_BIG="$(printf '{"kind":"image","mime":"image/png","data":"%s"}' "$BIG_B64")"
make_seal_payload "$TMP/seal-big.json" "Selo grande" "1. Um passo." "Ana" "$SEAL_BIG"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-big.json")"
if [ "$STATUS" = "400" ] || [ "$STATUS" = "413" ]; then
  pass "POST seal over 32 KB -> ${STATUS}"
else
  fail "POST seal over 32 KB (want 400 or 413, got ${STATUS:-no response})"
fi

make_seal_payload "$TMP/seal-put-cat.json" "Selo mutável" "1. Um passo." "Bia" \
  '{"kind":"sigil","id":"cat"}'
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-put-cat.json")"
check_status "PUT fixture with cat seal -> 201" 201
SEAL_PUT_ID="$(json_get id)"
STATUS="$(request GET "$BASE/r/$SEAL_PUT_ID")"
check_body_contains "page starts with the cat seal" 'data-seal="cat"'

make_seal_payload "$TMP/seal-put-owl.json" "Selo mutável" "1. Um passo." "Bia" \
  '{"kind":"sigil","id":"owl"}'
STATUS="$(request PUT "$BASE/api/recipes/$SEAL_PUT_ID" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/seal-put-owl.json")"
check_status "PUT changing the seal -> 200" 200

STATUS="$(request GET "$BASE/api/recipes/$SEAL_PUT_ID")"
check_eq "PUT updated the stored seal id" "owl" "$(json_get senderSeal.id)"
STATUS="$(request GET "$BASE/r/$SEAL_PUT_ID")"
check_body_contains "page reflects the updated owl seal" 'data-seal="owl"'
check_body_not_contains "page no longer shows the cat seal" 'data-seal="cat"'

echo
echo "== XSS and copy payload =="

XSS_TITLE='Teste <script>alert(1)</script>'
XSS_BODY="$(printf '%s\n' \
  '1. Misture <script>alert(1)</script> com o feijão.' \
  '2. Feche a tag </script> e continue.' \
  '3. SEGREDO-XSS **forte**')"

make_payload "$TMP/xss.json" "$XSS_TITLE" "$XSS_BODY" "Ana"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/xss.json")"
check_status "POST recipe containing script tags -> 201" 201
XSS_ID="$(json_get id)"

STATUS="$(request GET "$BASE/r/$XSS_ID")"
check_status "GET XSS share page -> 200" 200
check_body_not_contains "raw <script>alert is not emitted" '<script>alert'
check_body_contains "script text is escaped" '&lt;script&gt;alert(1)&lt;/script&gt;'
check_body_not_contains "raw <b> from recipe is not emitted" '<b>não vira negrito</b>'

if node - "$TMP/body" <<'NODE'
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const match = html.match(/data-copy="([^"]*)"/s);
if (!match) {
  console.error("data-copy attribute not found");
  process.exit(1);
}
const raw = match[1];
if (!raw.includes("&lt;script&gt;alert(1)&lt;/script&gt;")) {
  console.error("copy attribute does not escape script text");
  process.exit(2);
}
const decoded = raw
  .replace(/&#10;/g, "\n")
  .replace(/&#13;/g, "\r")
  .replace(/&#9;/g, "\t")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");
if (!decoded.includes("SEGREDO-XSS")) {
  console.error("copy payload lost the secret marker");
  process.exit(3);
}
if (!decoded.includes("</script>")) {
  console.error("copy payload lost the closing script tag");
  process.exit(4);
}
if (!decoded.includes("*forte*") || decoded.includes("**forte**")) {
  console.error("copy payload did not convert **bold** to *bold*");
  process.exit(5);
}
if (!decoded.includes("\n")) {
  console.error("copy payload lost newlines");
  process.exit(6);
}
NODE
then
  pass "copy payload survives </script>, quotes, and newlines"
else
  fail "copy payload is corrupted"
fi

echo
echo "== Validation errors =="

node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    title: "Grande",
    body: "x".repeat(70000),
    tags: []
  }));
' "$TMP/big.json"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/big.json")"
check_status "body over 64 KiB -> 413" 413
check_body_contains "413 body is too_large" '"error":"too_large"'

printf '%s' '{"body":"1. Um passo."}' >"$TMP/notitle.json"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/notitle.json")"
check_status "missing title -> 400" 400
check_body_contains "400 body is invalid" '"error":"invalid"'

echo
echo "== 404 and revocation =="

STATUS="$(request GET "$BASE/api/recipes/zzzzzzzzzzzz")"
check_status "unknown id JSON -> 404" 404
check_body_contains "unknown id is not_found" '"error":"not_found"'

STATUS="$(request GET "$BASE/r/zzzzzzzzzzzz")"
check_status "unknown id page -> 404" 404
check_header_contains "404 page is HTML" 'content-type' 'text/html'
check_body_contains "404 page uses design copy" 'Esta receita não está mais disponível.'
check_body_contains "404 page has home action" 'Voltar para o início'

STATUS="$(request DELETE "$BASE/api/recipes/$ID" \
  -H "X-App-Key: $APP_KEY_VALUE")"
check_status "DELETE recipe -> 204" 204

STATUS="$(request GET "$BASE/api/recipes/$ID")"
check_status "GET revoked JSON -> 410" 410
check_body_contains "revoked JSON body" '"error":"revoked"'

STATUS="$(request GET "$BASE/r/$ID")"
check_status "GET revoked page -> 410" 410
check_header_contains "revoked page is HTML" 'content-type' 'text/html'
check_body_contains "revoked page explains" 'não está mais disponível'
check_body_contains "revoked page uses the calm 410 copy" 'O remetente desativou este link.'

echo
echo "== Idempotency =="

IDEM="smoke-$(date +%s%N)-$$"
make_payload "$TMP/idem.json" "Receita idempotente" "1. Um passo." "Lucas"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H "X-Idempotency-Key: $IDEM" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/idem.json")"
check_status "idempotent POST first try -> 201" 201
IDEM_ID="$(json_get id)"
STATUS="$(request POST "$BASE/api/recipes" \
  -H "X-App-Key: $APP_KEY_VALUE" \
  -H "X-Idempotency-Key: $IDEM" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP/idem.json")"
check_status "idempotent POST retry -> 201" 201
check_eq "retry returns the original id" "$IDEM_ID" "$(json_get id)"

echo
echo "== Static routes =="

STATUS="$(request GET "$BASE/")"
check_status "install page -> 200" 200
check_header_contains "install page is HTML" 'content-type' 'text/html'
check_body_contains "install page mentions fontes desconhecidas" 'fontes desconhecidas'
check_body_contains "install page mentions Instalar mesmo assim" 'Instalar mesmo assim'
check_body_not_contains "QR placeholder is gone" 'QR code em breve'
check_body_contains "install step points at the button below" 'no botão abaixo'
check_body_contains "install page has numbered steps" 'class="install-steps"'
check_body_contains "install page has the Play Protect warning" 'Mais detalhes'

if node - "$TMP/body" <<'NODE'
const fs = require("fs");
let html = fs.readFileSync(process.argv[2], "utf8");
html = html.replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, "");
const matches = html.match(/https?:\/\//gi) || [];
if (matches.length) {
  console.error(`unexpected external reference(s): ${matches.join(", ")}`);
  process.exit(1);
}
NODE
then
  pass "no external http(s) resources in install page"
else
  fail "install page references an external http(s) resource"
fi

STATUS="$(request GET "$BASE/.well-known/assetlinks.json")"
check_status "assetlinks -> 200" 200
check_header_contains "assetlinks is JSON" 'content-type' 'application/json'
check_body_contains "assetlinks served verbatim" '[]'

STATUS="$(request GET "$BASE/app/version.json")"
check_status "version.json -> 200" 200
check_eq "version.json versionName" "1.0.0" "$(json_get versionName)"

STATUS="$(request GET "$BASE/app/latest.apk")"
check_status "APK without APK_URL -> 404" 404

STATUS="$(request GET "$BASE/robots.txt")"
check_status "robots.txt -> 200" 200
check_body_contains "robots.txt disallows all" 'Disallow: /'

STATUS="$(request GET "$BASE/assets/page.js")"
check_status "page.js -> 200" 200
check_header_contains "page.js content type" 'content-type' 'application/javascript'
check_header_contains "page.js immutable cache" 'cache-control' 'immutable'

STATUS="$(request GET "$BASE/nao-existe")"
check_status "unknown route -> 404" 404

echo
echo "----------------------------------------------"
echo "Smoke test summary: ${PASSED} passed, ${FAILED} failed"
if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: FAIL"
  echo
  echo "Last wrangler log lines:"
  tail -n 40 "$LOG" | sed 's/^/  /'
  exit 1
fi
echo "RESULT: PASS"
