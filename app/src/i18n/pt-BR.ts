function stepLabel(count: number): string {
  return count === 1 ? '1 passo' : `${count} passos`;
}

function timeAgo(sentAt: number): string {
  const diff = Date.now() - sentAt;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (diff < 0) return 'agora';
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  if (hours === 1) return 'há 1 h';
  if (hours < 24) return `há ${hours} h`;
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} d`;
  if (days < 30) return `há ${Math.floor(days / 7)} sem`;
  return `há ${Math.floor(days / 30)} m`;
}

export const ptBR = {
  appName: 'My Recipes',
  recipesHeader: 'Receitas',
  recipesTab: 'Receitas',
  mailboxTab: 'Cartas',
  trashTab: 'Lixeira',
  settingsTab: 'Ajustes',
  recipeHeader: 'Receita',
  searchPlaceholder: 'Buscar receitas…',
  filterAll: 'Todas',
  filterPinned: 'Fixadas',
  emptyTitle: 'Nenhuma receita ainda',
  emptyBody: 'Cole sua primeira receita ou toque em + para começar.',
  newRecipe: 'Nova receita',
  addRecipe: 'Adicionar receita',
  pasteRecipe: 'Colar receita',
  pasteTitle: 'Colar receita',
  pastePlaceholder: 'Cole aqui a receita do WhatsApp…',
  pasteFromClipboard: 'Colar da área de transferência',
  previewTitle: 'Pré-visualização',
  previewEmpty: 'Cole um texto para ver o título e os passos.',
  createRecipe: 'Criar receita',
  cancel: 'Cancelar',
  save: 'Salvar',
  edit: 'Editar',
  delete: 'Excluir',
  pin: 'Fixar',
  unpin: 'Desafixar',
  share: 'Compartilhar',
  send: 'Enviar',
  copy: 'Copiar',
  copied: 'Receita copiada.',
  shareComingSoon: 'Compartilhamento em breve.',
  creatingLink: 'Criando link…',
  shareFailed: 'Não foi possível criar o link.',
  retry: 'Tentar de novo',
  someone: 'Alguém',
  moreOptions: 'Mais opções',
  close: 'Fechar',
  understood: 'Entendi',
  undo: 'Desfazer',
  movedToTrash: 'Receita movida para a lixeira',
  deleteConfirmTitle: 'Excluir receita?',
  deleteConfirmBody: 'A receita vai para a lixeira e pode ser restaurada por 30 dias.',
  deleteConfirmAction: 'Excluir',
  back: 'Voltar',
  titleLabel: 'Título',
  bodyLabel: 'Receita',
  titlePlaceholder: 'Título da receita',
  bodyPlaceholder: 'Escreva a receita em Markdown…',
  bold: 'Negrito',
  italic: 'Itálico',
  headingAction: 'Título',
  bulleted: 'Lista com marcadores',
  numbered: 'Lista numerada',
  checkbox: 'Tarefa',
  divider: 'Separador',
  previewShort: 'Prévia',
  discardTitle: 'Descartar alterações?',
  discardBody: 'Você tem alterações que ainda não foram salvas.',
  discardAction: 'Descartar',
  keepEditing: 'Continuar editando',
  titleRequired: 'O título não pode ficar vazio.',
  recipeNotFound: 'Receita não encontrada.',
  trashTitle: 'Lixeira',
  trashEmpty: 'A lixeira está vazia',
  trashEmptyBody: 'Receitas excluídas aparecem aqui por 30 dias.',
  trashRestoreHint: 'Toque para restaurar. Segure para apagar para sempre.',
  trashRestored: 'Receita restaurada',
  trashPurged: 'Receita apagada para sempre',
  restore: 'Restaurar',
  purgeForever: 'Apagar para sempre',
  purgeConfirmTitle: 'Apagar para sempre?',
  purgeConfirmBody: 'Esta receita será removida definitivamente. Não dá para desfazer.',
  purgeConfirmAction: 'Apagar',
  purgeFailed: 'Não foi possível apagar a receita.',
  restoreFailed: 'Não foi possível restaurar a receita.',
  trashExpiresIn: (days: number) =>
    days <= 0 ? 'expira hoje' : days === 1 ? 'expira em 1 dia' : `expira em ${days} dias`,
  trashItemAccessibility: (title: string, days: number) =>
    days <= 0
      ? `${title}, expira hoje`
      : days === 1
        ? `${title}, expira em 1 dia`
        : `${title}, expira em ${days} dias`,
  exportBackup: 'Exportar backup',
  importBackup: 'Importar backup',
  exportingBackup: 'Exportando…',
  importingBackup: 'Importando…',
  exportSummary: (count: number) =>
    count === 1 ? '1 receita exportada' : `${count} receitas exportadas`,
  exportEmpty: 'Não há receitas para exportar.',
  importSummary: (inserted: number, existing: number) => {
    const insertedPart =
      inserted === 0 ? 'Nenhuma receita nova' : inserted === 1 ? '1 nova' : `${inserted} novas`;
    if (existing === 0) return insertedPart;
    const existingPart = existing === 1 ? '1 já existente' : `${existing} já existentes`;
    return `${insertedPart}, ${existingPart}`;
  },
  importNoticeTitle: 'Backup importado',
  importNoNewRecipes: (existing: number) =>
    existing === 1
      ? 'A única receita do backup já estava neste aparelho. Nada foi alterado.'
      : `As ${existing} receitas do backup já estavam neste aparelho. Nada foi alterado.`,
  importMissingFiles: (count: number) =>
    count === 1
      ? '1 receita do backup não tinha o arquivo e foi ignorada.'
      : `${count} receitas do backup não tinham o arquivo e foram ignoradas.`,
  backupShareDialog: 'Compartilhar backup',
  backupExportFailed: 'Não foi possível exportar o backup.',
  backupImportFailed: 'Não foi possível importar o backup.',
  backupUnreadable: 'Não foi possível ler o arquivo escolhido.',
  backupInvalidArchive: 'Este arquivo não é um backup válido.',
  backupTooLarge: 'O arquivo é maior que 50 MB.',
  backupShareUnavailable: 'Não foi possível abrir o compartilhamento.',
  settingsTitle: 'Ajustes',
  displayNameLabel: 'Nome de exibição',
  displayNamePlaceholder: 'Seu nome',
  sealTitle: 'Seu selo',
  sealHint: 'Escolha um dos seis selos ou envie uma foto.',
  sealPreviewLabel: 'Pré-visualização',
  sealSigilNames: {
    bee: 'Abelha',
    cat: 'Gato',
    leaf: 'Folha',
    moon: 'Lua',
    mushroom: 'Cogumelo',
    sea: 'Mar',
    sun: 'Sol',
    star: 'Estrela',
    owl: 'Coruja',
  },
  sealSigilSelected: (name: string) => `${name}, selecionado`,
  sealSendImage: 'Enviar imagem',
  sealPreparingImage: 'Preparando imagem…',
  sealSaved: 'Selo salvo.',
  sealImageSaved: 'Selo de imagem salvo.',
  sealPermissionDenied: 'Permita o acesso às fotos para escolher uma imagem.',
  sealImageFailed: 'Não foi possível preparar a imagem.',
  sealImageTooLarge: 'A imagem ficou grande demais. Tente outra foto.',
  sealSaveFailed: 'Não foi possível salvar o selo.',
  nameSaveFailed: 'Não foi possível salvar o nome.',
  notSet: 'Não definido',
  versionLabel: (version: string) => `Versão ${version}`,
  checkForUpdate: 'Verificar atualização',
  checkingUpdate: 'Verificando…',
  updateAvailableTitle: 'Nova versão disponível',
  updateNow: 'Atualizar',
  updateLater: 'Depois',
  updateSize: (size: string) => `Download: ${size}`,
  updateUpToDate: 'Você está na versão mais recente',
  updateAvailableInline: (version: string) => `Versão ${version} disponível`,
  updateUnknownVersion: 'Não foi possível identificar a versão instalada.',
  updateDownloadingTitle: 'Baixando atualização',
  updateDownloading: (percent: number) => `Baixando… ${percent}%`,
  updateFailedTitle: 'A atualização falhou',
  updateOffline: 'Sem conexão',
  updateCorrupt: 'O download falhou, tente novamente',
  updateServer: 'Não foi possível verificar a atualização.',
  updatePermissionTitle: 'Permita a instalação',
  updatePermissionBody:
    'Para atualizar, o Android precisa permitir que o My Recipes instale aplicativos.',
  updateOpenSettings: 'Abrir ajustes',
  stepsLabel: stepLabel,
  trashCount: (count: number) =>
    count === 1 ? '1 receita na lixeira' : `${count} receitas na lixeira`,
  recipeBy: (name: string) => `Receita de ${name}`,
  yourRecipe: 'Sua receita',
  letterFrom: (name: string) => `Carta de ${name}`,
  pinnedLabel: 'Fixada',
  listItemHint: 'Toque e segure para mais opções.',
  listItemAccessibility: (title: string, count: number, pinned: boolean) =>
    `${title}, ${stepLabel(count)}${pinned ? ', fixada' : ''}`,
  newLetter: 'Nova carta',
  sharedRecipe: 'Receita compartilhada',
  openingLetter: 'Abrindo carta…',
  invalidShareLink: 'Este link não é válido.',
  shareUnavailable: 'Esta receita não está mais disponível.',
  shareRevoked: 'O remetente desativou este link.',
  offlineRetry: 'Sem conexão — tentar de novo.',
  serverErrorRetry: 'Algo deu errado — tentar de novo.',
  saveFailed: 'Não foi possível salvar a receita.',
  updateFailed: 'Não foi possível atualizar a cópia.',
  alreadyImported: 'Você já tem esta receita.',
  ownRecipe: 'Esta receita é sua.',
  ownRecipeBody: 'Você compartilhou este link. A cópia local é a original.',
  newerCopy: 'Há uma versão mais nova desta receita.',
  viewRecipe: 'Ver receita',
  updateCopy: 'Atualizar cópia',
  discard: 'Descartar',
  savingRecipe: 'Salvando…',
  updatingCopy: 'Atualizando…',
  recipeSaved: 'Receita salva',
  copyUpdated: 'Cópia atualizada',
  shareLinkTitle: 'Link de receita',
  shareLinkDetected: 'Toque em Abrir link para ver a receita.',
  openLink: 'Abrir link',

  // Mailbox
  mailboxHeader: 'Caixa de entrada',
  mailboxEmpty: 'Nenhuma carta ainda.',
  mailboxEmptyBody: 'Compartilhe uma receita com um contato.',
  mailboxCount: (count: number) =>
    count === 1 ? '1 carta não lida' : `${count} cartas não lidas`,
  mailboxItemAccessibility: (sender: string, title: string, unread: boolean) =>
    `${unread ? 'Carta não lida de' : 'Carta de'} ${sender}, ${title}`,
  mailboxItemHint: 'Toque para abrir. Segure para marcar como lida ou remover.',
  letterUnavailable: 'Carta indisponível.',
  markRead: 'Marcar como lida',
  markUnread: 'Marcar como não lida',
  removeLetter: 'Remover carta',
  removeLetterConfirmTitle: 'Remover carta?',
  removeLetterConfirmBody: 'A carta será removida da sua caixa de entrada.',
  letterRemoveFailed: 'Não foi possível remover a carta.',
  mailboxLoadFailed: 'Não foi possível atualizar as cartas.',
  offlineNote: 'Sem conexão. Mostrando cartas salvas.',
  timeAgo,

  // Send flow
  sendMenuTitle: 'Enviar receita',
  sendToContact: 'Enviar para um contato',
  shareLink: 'Compartilhar link',
  contactPickerTitle: 'Escolha um contato',
  noContactsTitle: 'Nenhum contato ainda',
  noContactsBody: 'Adicione um contato em Cartas → Contatos.',
  noContactsAdd: 'Adicionar contato',
  letterSent: (name: string) => `Carta enviada para ${name}.`,
  letterSendFailed: 'Não foi possível enviar a carta.',
  letterMailboxFull: 'A caixa de entrada desta pessoa está cheia.',

  // Contacts
  addContact: 'Adicionar contato',
  contactsTitle: 'Contatos',
  contactsEmpty: 'Nenhum contato ainda.',
  contactsEmptyBody: 'Adicione o endereço de quem pode te enviar receitas.',
  yourAddress: 'Seu endereço',
  addressNotReady: 'Seu endereço aparece quando você abre a Caixa de entrada pela primeira vez.',
  copyAddress: 'Copiar endereço',
  shareAddress: 'Compartilhar endereço',
  addressCopied: 'Endereço copiado.',
  addressSharedTitle: 'Meu endereço no My Recipes',
  contactName: 'Nome do contato',
  contactAddress: 'Endereço',
  contactAddressPlaceholder: 'Cole o endereço da pessoa…',
  contactNamePlaceholder: 'Como chamar este contato',
  contactInvalidAddress: 'Endereço inválido.',
  contactNotFound: 'Endereço não encontrado.',
  contactExists: 'Este contato já está salvo.',
  contactResolveFailed: 'Não foi possível buscar este endereço.',
  contactAddFailed: 'Não foi possível adicionar o contato.',
  contactEditFailed: 'Não foi possível salvar o nome.',
  contactRemoveFailed: 'Não foi possível remover o contato.',
  contactAddConfirmTitle: (name: string) => `Adicionar ${name}?`,
  contactAddConfirmBody: (address: string) =>
    `Este endereço será salvo na sua lista de contatos:\n${address}`,
  contactSaveName: 'Salvar nome',
  contactEditName: 'Editar nome',
  contactRemove: 'Remover contato',
  contactRemoveConfirmTitle: 'Remover contato?',
  contactRemoveConfirmBody: (name: string) =>
    `${name} será removido da sua lista de contatos.`,
  contactLastSent: (when: string) => `Enviado ${when}`,
  contactNeverSent: 'Nunca enviado',
  contactAccessibility: (name: string, address: string) => `${name}, ${address}`,
  contactHint: 'Toque e segure para editar o nome ou remover.',

  // Settings rows
  trashRow: 'Lixeira',
} as const;

export type Strings = typeof ptBR;
