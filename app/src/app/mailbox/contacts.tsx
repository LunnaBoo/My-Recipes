import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ActionSheet, type ActionSheetItem } from '../../components/ActionSheet';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Seal } from '../../components/Seal';
import { Snackbar } from '../../components/Snackbar';
import { IvyWreath } from '../../components/ornaments';
import type { ContactRow } from '../../db/types';
import {
  addContact,
  getMailbox,
  listContacts,
  removeContact,
  updateContactName,
} from '../../db/mailboxRepository';
import { ptBR } from '../../i18n/pt-BR';
import { fetchMailboxProfile, isMailboxApiError } from '../../lib/mailboxApi';
import { parseMailboxAddress } from '../../lib/mailbox';
import { sealFromStored, sealToStored } from '../../lib/seal';
import { theme } from '../../theme';

type DialogState =
  | { kind: 'none' }
  | { kind: 'add'; address: string; name: string; sealJson: string | null }
  | { kind: 'edit'; contact: ContactRow; name: string }
  | { kind: 'remove'; contact: ContactRow };

type MenuState = { kind: 'none' } | { kind: 'contact'; contact: ContactRow };

function EmptyContacts() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyCard}>
        <IvyWreath />
        <Text style={styles.emptyTitle}>{ptBR.contactsEmpty}</Text>
        <Text style={styles.emptyBody}>{ptBR.contactsEmptyBody}</Text>
      </View>
    </View>
  );
}

function ContactRowView({
  contact,
  onPress,
  onLongPress,
}: {
  contact: ContactRow;
  onPress: (contact: ContactRow) => void;
  onLongPress: (contact: ContactRow) => void;
}) {
  const seal = sealFromStored(contact.seal_json);
  const lastSent = contact.last_sent_at
    ? ptBR.contactLastSent(ptBR.timeAgo(contact.last_sent_at))
    : ptBR.contactNeverSent;

  return (
    <Pressable
      accessibilityLabel={ptBR.contactAccessibility(contact.display_name, contact.mailbox_address)}
      accessibilityHint={ptBR.contactHint}
      accessibilityRole="button"
      onLongPress={() => onLongPress(contact)}
      onPress={() => onPress(contact)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Seal seal={seal} size={40} />

      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={styles.rowName}>
          {contact.display_name}
        </Text>
        <Text style={styles.rowAddress}>{contact.mailbox_address}</Text>
        <Text style={styles.rowMeta}>{lastSent}</Text>
      </View>

      <View pointerEvents="none" style={styles.rule} />
    </Pressable>
  );
}

/** Contacts and own-address screen. */
export default function ContactsScreen() {
  const router = useRouter();

  const [address, setAddress] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputAddress, setInputAddress] = useState('');
  const [resolving, setResolving] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [menu, setMenu] = useState<MenuState>({ kind: 'none' });
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [mailbox, rows] = await Promise.all([
      getMailbox().catch((error: unknown) => {
        console.warn('[contacts] mailbox load failed:', error);
        return null;
      }),
      listContacts().catch((error: unknown) => {
        console.warn('[contacts] list failed:', error);
        return [];
      }),
    ]);

    setAddress(mailbox?.address ?? null);
    setContacts(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      load()
        .then(() => {
          if (!cancelled) setLoading(false);
        })
        .catch((error: unknown) => {
          console.warn('[contacts] load failed:', error);
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const handleCopyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await Clipboard.setStringAsync(address);
      setSnackbar(ptBR.addressCopied);
    } catch (error) {
      console.warn('[contacts] copy failed:', error);
    }
  }, [address]);

  const handleShareAddress = useCallback(async () => {
    if (!address) return;
    try {
      await Share.share({
        message: `${ptBR.addressSharedTitle}\n\n${address}`,
      });
    } catch (error) {
      console.warn('[contacts] share failed:', error);
    }
  }, [address]);

  const handleResolve = useCallback(async () => {
    const parsed = parseMailboxAddress(inputAddress);
    if (!parsed) {
      setSnackbar(ptBR.contactInvalidAddress);
      return;
    }

    const existing = contacts.find((c) => c.mailbox_address === parsed);
    if (existing) {
      setSnackbar(ptBR.contactExists);
      return;
    }

    setResolving(true);
    try {
      const profile = await fetchMailboxProfile(parsed);
      const sealJson = profile.seal ? sealToStored(profile.seal) : null;
      setDialog({ kind: 'add', address: parsed, name: profile.name, sealJson });
    } catch (error) {
      console.warn('[contacts] resolve failed:', error);
      if (isMailboxApiError(error) && error.code === 'not_found') {
        setSnackbar(ptBR.contactNotFound);
      } else if (isMailboxApiError(error) && error.code === 'offline') {
        setSnackbar(ptBR.offlineRetry);
      } else {
        setSnackbar(ptBR.contactResolveFailed);
      }
    } finally {
      setResolving(false);
    }
  }, [contacts, inputAddress]);

  const handleAddConfirm = useCallback(async () => {
    if (dialog.kind !== 'add') return;

    try {
      await addContact({
        address: dialog.address,
        displayName: dialog.name || ptBR.someone,
        sealJson: dialog.sealJson,
      });
      setInputAddress('');
      setDialog({ kind: 'none' });
      await load();
    } catch (error) {
      console.warn('[contacts] add failed:', error);
      setSnackbar(ptBR.contactAddFailed);
    }
  }, [dialog, load]);

  const handleEditConfirm = useCallback(async () => {
    if (dialog.kind !== 'edit') return;

    try {
      await updateContactName(dialog.contact.id, dialog.name);
      setDialog({ kind: 'none' });
      await load();
    } catch (error) {
      console.warn('[contacts] edit failed:', error);
      setSnackbar(ptBR.contactEditFailed);
    }
  }, [dialog, load]);

  const handleRemoveConfirm = useCallback(async () => {
    if (dialog.kind !== 'remove') return;

    try {
      await removeContact(dialog.contact.id);
      setDialog({ kind: 'none' });
      await load();
    } catch (error) {
      console.warn('[contacts] remove failed:', error);
      setSnackbar(ptBR.contactRemoveFailed);
    }
  }, [dialog, load]);

  const openMenu = useCallback((contact: ContactRow) => {
    setMenu({ kind: 'contact', contact });
  }, []);

  const menuContact = menu.kind === 'contact' ? menu.contact : null;
  const menuItems: ActionSheetItem[] = menuContact
    ? [
        {
          label: ptBR.contactEditName,
          onPress: () => {
            setMenu({ kind: 'none' });
            setDialog({ kind: 'edit', contact: menuContact, name: menuContact.display_name });
          },
        },
        {
          label: ptBR.contactRemove,
          tone: 'destructive',
          onPress: () => {
            setMenu({ kind: 'none' });
            setDialog({ kind: 'remove', contact: menuContact });
          },
        },
      ]
    : [];

  return (
    <ScreenFrame corners="top">
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        <View style={styles.backHeader}>
          <Pressable
            accessibilityLabel={ptBR.back}
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backChevron}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{ptBR.contactsTitle}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{ptBR.yourAddress}</Text>

          {address ? (
            <>
              <Text selectable style={styles.addressValue}>
                {address}
              </Text>
              <View style={styles.addressActions}>
                <Pressable
                  accessibilityLabel={ptBR.copyAddress}
                  accessibilityRole="button"
                  onPress={() => void handleCopyAddress()}
                  style={({ pressed }) => [styles.addressAction, pressed && styles.pressed]}
                >
                  <Text style={styles.addressActionLabel}>{ptBR.copyAddress}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={ptBR.shareAddress}
                  accessibilityRole="button"
                  onPress={() => void handleShareAddress()}
                  style={({ pressed }) => [styles.addressAction, pressed && styles.pressed]}
                >
                  <Text style={styles.addressActionLabel}>{ptBR.shareAddress}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={styles.addressHint}>{ptBR.addressNotReady}</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{ptBR.addContact}</Text>
          <TextInput
            accessibilityLabel={ptBR.contactAddress}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setInputAddress}
            placeholder={ptBR.contactAddressPlaceholder}
            style={styles.input}
            value={inputAddress}
          />
          <Pressable
            accessibilityLabel={ptBR.addContact}
            accessibilityRole="button"
            accessibilityState={{ busy: resolving, disabled: resolving || inputAddress.length === 0 }}
            disabled={resolving || inputAddress.length === 0}
            onPress={() => void handleResolve()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              (resolving || inputAddress.length === 0) && styles.disabled,
            ]}
          >
            {resolving ? (
              <ActivityIndicator color={theme.colors.cream} size="small" />
            ) : (
              <Text style={styles.primaryButtonLabel}>{ptBR.addContact}</Text>
            )}
          </Pressable>
        </View>

        {contacts.length === 0 && !loading ? (
          <EmptyContacts />
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={contacts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ContactRowView contact={item} onLongPress={openMenu} onPress={() => {}} />
            )}
            scrollEnabled={false}
            style={styles.list}
          />
        )}
      </ScrollView>

      {snackbar ? (
        <Snackbar key={snackbar} message={snackbar} onDismiss={() => setSnackbar(null)} />
      ) : null}

      <ActionSheet
        items={menuItems}
        onDismiss={() => setMenu({ kind: 'none' })}
        title={menuContact?.display_name}
        visible={menu.kind === 'contact'}
      />

      <ConfirmDialog
        body={ptBR.contactAddConfirmBody(dialog.kind === 'add' ? dialog.address : '')}
        cancelLabel={ptBR.cancel}
        confirmLabel={ptBR.addContact}
        onConfirm={handleAddConfirm}
        onDismiss={() => setDialog({ kind: 'none' })}
        title={dialog.kind === 'add' ? ptBR.contactAddConfirmTitle(dialog.name) : ''}
        visible={dialog.kind === 'add'}
      />

      <ConfirmDialog
        cancelLabel={ptBR.cancel}
        confirmLabel={ptBR.contactSaveName}
        input={
          dialog.kind === 'edit'
            ? {
                value: dialog.name,
                onChangeText: (name) => setDialog({ ...dialog, name }),
                placeholder: ptBR.contactNamePlaceholder,
                autoFocus: true,
              }
            : undefined
        }
        onConfirm={handleEditConfirm}
        onDismiss={() => setDialog({ kind: 'none' })}
        title={ptBR.contactEditName}
        visible={dialog.kind === 'edit'}
      />

      <ConfirmDialog
        body={
          dialog.kind === 'remove'
            ? ptBR.contactRemoveConfirmBody(dialog.contact.display_name)
            : undefined
        }
        cancelLabel={ptBR.cancel}
        confirmLabel={ptBR.contactRemove}
        destructive
        onConfirm={handleRemoveConfirm}
        onDismiss={() => setDialog({ kind: 'none' })}
        title={ptBR.contactRemoveConfirmTitle}
        visible={dialog.kind === 'remove'}
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  backHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
  },
  backChevron: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
    fontSize: 28,
    lineHeight: 30,
    marginTop: -4,
  },
  headerTitle: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
  },
  card: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderRadius: theme.radii.lg,
  },
  cardLabel: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textTransform: 'uppercase',
  },
  addressValue: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
    textAlign: 'center',
    letterSpacing: 1.5,
  },
  addressHint: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
    textAlign: 'center',
  },
  addressActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'center',
  },
  addressAction: {
    minHeight: 40,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: theme.colors.inkLight,
    backgroundColor: theme.colors.parchment,
  },
  addressActionLabel: {
    ...theme.typography.button,
    color: theme.colors.ink,
    fontSize: 12,
  },
  input: {
    ...theme.typography.body,
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1.5,
    borderColor: theme.colors.inkLight,
    backgroundColor: theme.colors.parchment,
    color: theme.colors.ink,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 24,
    backgroundColor: theme.colors.oliveTab,
  },
  primaryButtonLabel: {
    ...theme.typography.button,
    color: theme.colors.cream,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: theme.spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    minHeight: 76,
  },
  rowPressed: {
    backgroundColor: theme.colors.sageLight,
    borderRadius: theme.radii.md,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    ...theme.typography.listTitle,
    color: theme.colors.ink,
  },
  rowAddress: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    letterSpacing: 0.5,
  },
  rowMeta: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
  },
  rule: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.25,
    backgroundColor: theme.colors.inkLight,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  emptyCard: {
    width: '100%',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderRadius: theme.radii.lg,
  },
  emptyTitle: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
    textAlign: 'center',
    maxWidth: 240,
  },
});
