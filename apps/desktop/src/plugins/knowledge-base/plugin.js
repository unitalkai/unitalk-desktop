import {
  atom,
  Button,
  CAPABILITIES_TABS_AREA,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  GlyphSpinner,
  host,
  icons,
  Input,
  Textarea,
  Tip,
  usePluginI18n,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export const ID = 'knowledge-base'
export const PDF_MAX_BYTES = 200 * 1024 * 1024
export const OTHER_MAX_BYTES = 20 * 1024 * 1024
export const SESSION_PUSH_MS = 40 * 1000
// Credentials only change on sign-in / org switch; re-send them now and then anyway so a backend
// that lost them (cleared after an ended session, new profile) recovers without a restart.
export const CREDENTIALS_RESEND_MS = 5 * 60 * 1000
export const COMPOSER_LEADING_AREA = 'composer.leading'
export const MANAGE_ROUTE = `/capabilities?tab=${encodeURIComponent(`${ID}:bases`)}`
export const FILES_POLL_MS = 5000
const UPLOAD_TIMEOUT_MS = 20 * 60 * 1000
const PENDING_STATUSES = new Set(['uploading', 'pending', 'processing'])
const SESSION_CODES = new Set(['kb_session_required', 'kb_session_invalid'])
const NO_SESSION = atom({ activeOrganization: null, status: 'disabled', user: null })

export const LOCALES = {
  en: {
    tabTitle: 'Knowledge base',
    title: 'Knowledge',
    created: 'Knowledge base created',
    createFailed: 'Failed to create knowledge base',
    renameFailed: 'Failed to rename knowledge base',
    deleted: 'Knowledge base deleted',
    deleteFailed: 'Failed to delete knowledge base',
    removeFilesFailed: 'Failed to delete files',
    myBases: 'My knowledge bases',
    sharedBases: 'Shared with me',
    noBase: 'No knowledge base',
    readOnly: 'Shared, read-only',
    emptyTitle: "You haven't created a knowledge base yet",
    emptyAction: 'Create my first knowledge base',
    firstKnowledgeBaseName: 'My first knowledge base',
    bootstrapLoading: 'Setting up your knowledge base…',
    selectPromptTitle: 'Select a knowledge base from the list',
    renameTooltip: 'Rename knowledge base',
    uploadFiles: 'Upload files',
    rename: 'Rename',
    deleteBase: 'Delete base',
    deleteBaseTitle: 'Delete knowledge base',
    deleteBaseConfirm: name => `Are you sure you want to delete "${name}"? This action cannot be undone.`,
    dropTitle: 'Drag and drop your files here',
    dropDesc:
      'Import documents (HTML, JSON, Markdown, PPTX, DOCX, PDF, TXT, CSV, code…) or entire folders to feed your knowledge base.',
    emptySharedTitle: 'This shared knowledge base has no files yet',
    uploadFile: 'Upload a file',
    uploadFolder: 'Upload a folder',
    whatForTitle: 'What is a knowledge base for?',
    whatForDesc:
      'It allows you to gather your documents and connect them to your AI Collaborator. You can then chat with this base to easily extract, analyze, and search for key information.',
    selected: count => `${count} selected`,
    restartVectorization: 'Restart vectorization',
    bulkDelete: 'Bulk delete',
    colFile: 'File',
    colStatus: 'Status',
    colDate: 'Creation date',
    colSize: 'Size',
    vectorized: 'Vectorized',
    vectorizedChunks: count => `Vectorized, ${count} chunk${count === 1 ? '' : 's'}`,
    uploadingStatus: 'Uploading…',
    pendingStatus: 'Waiting to be processed…',
    processing: 'Processing…',
    progress: (done, total) => `${done}/${total} batches`,
    skippedPages: pages => `Pages skipped: ${pages}`,
    failedAt: step => `Failed at ${step}`,
    errorRef: id => `ref ${id}`,
    steps: {
      auth: 'sign-in check',
      clerk_mint: 'Unitalk session',
      convex_request: 'knowledge base service',
      blob_upload: 'file upload',
      upload_url: 'upload preparation',
      verify_upload: 'upload check',
      download_url: 'download link',
      download: 'reading the stored file',
      split_pdf: 'PDF splitting',
      read_text: 'reading the text',
      partition: 'text extraction',
      ocr: 'text recognition (OCR)',
      extract_text: 'text extraction',
      embed: 'embeddings',
      save_chunks: 'saving passages',
      qdrant_upsert: 'indexing',
      qdrant_delete: 'index cleanup',
      search_embed: 'search embeddings',
      qdrant_search: 'search',
      load_chunks: 'loading passages',
      blob_delete: 'file removal',
      database: 'database'
    },
    errorRetry: 'Error, retry',
    retry: 'Try again',
    download: 'Download',
    downloadFailed: 'Could not download the file',
    delete: 'Delete',
    cancel: 'Cancel',
    typeFile: 'File',
    createTitle: 'Create a knowledge base',
    baseNamePlaceholder: 'My knowledge base',
    descriptionPlaceholder: 'Knowledge base description (optional)',
    create: 'Create',
    uploading: 'Uploading…',
    uploadFailed: 'Could not upload one or more files',
    fileTooLarge: 'Some files were skipped because they exceed the size limit (PDF 200MB, other 20MB).',
    duplicateTitle: 'Already in this knowledge base',
    duplicateMessage: count =>
      count === 1
        ? 'One file was already in this knowledge base.'
        : `${count} files were already in this knowledge base.`,
    retryParseFailed: 'Could not restart processing',
    loading: 'Loading knowledge bases…',
    loadFailed: 'Could not load knowledge bases',
    filesLoadFailed: 'Could not load files',
    searchFailed: 'Search failed',
    signInTitle: 'Sign in to Unitalk',
    signInHint: 'Knowledge bases belong to your Unitalk account. Sign in to see and manage them.',
    signIn: 'Sign in',
    backendTitle: 'Knowledge base backend unavailable',
    backendHint: 'Install the knowledge-base plugin package and restart the gateway.',
    notConfiguredTitle: 'Knowledge base not configured',
    notConfiguredHint: 'Set KB_CONVEX_SITE_URL for this Hermes profile, then restart the gateway.',
    unsupportedTitle: 'Update Unitalk Desktop',
    unsupportedHint: 'This version of the app cannot share your Unitalk session with plugins yet.',
    composerLabel: 'Knowledge',
    composerTitle: 'Knowledge bases for the agent',
    composerAllActive: 'All knowledge bases',
    composerActiveCount: count => (count === 1 ? '1 knowledge base' : `${count} knowledge bases`),
    composerNoneActive: 'Knowledge bases off',
    composerEmpty: 'No knowledge base yet',
    composerSignIn: 'Sign in to use your knowledge bases',
    composerLoadFailed: 'Could not load knowledge bases',
    composerManage: 'Manage knowledge bases',
    composerSaveFailed: 'Could not update the active knowledge bases',
    errors: {
      kb_not_configured: 'The knowledge base is not configured on this Hermes instance.',
      kb_session_required: 'Sign in to Unitalk to use your knowledge bases.',
      kb_session_invalid: 'Your Unitalk session expired. Sign in again.',
      kb_organization_unavailable: 'You no longer have access to this organization. Switch organization and try again.',
      too_large: 'The file exceeds the size limit (PDF 200MB, other 20MB).',
      split_required: 'This PDF is too large to be processed without splitting it into parts.',
      unsupported_type: 'This file type is not supported.',
      duplicate: 'This file is already in the knowledge base.',
      forbidden: 'You do not have permission to do this.',
      not_found: 'This item no longer exists.',
      invalid: 'The request was rejected.',
      invalid_id: 'The request was rejected.',
      empty_file: 'The file is empty.',
      upload_failed: 'The file could not be sent to storage.',
      upstream: 'The knowledge base service is unavailable. Try again later.'
    }
  },
  fr: {
    tabTitle: 'Base de connaissances',
    title: 'Bases de connaissances',
    created: 'Base de connaissances créée',
    createFailed: 'Échec de la création de la base de connaissances',
    renameFailed: 'Échec du renommage de la base de connaissances',
    deleted: 'Base de connaissances supprimée',
    deleteFailed: 'Échec de la suppression de la base de connaissances',
    removeFilesFailed: 'Échec de la suppression des fichiers',
    myBases: 'Mes bases de connaissances',
    sharedBases: 'Partagées avec moi',
    noBase: 'Aucune base de connaissances',
    readOnly: 'Partagée, lecture seule',
    emptyTitle: 'Vous n’avez pas encore créé de base de connaissances',
    emptyAction: 'Créer ma première base de connaissances',
    firstKnowledgeBaseName: 'Ma première base de connaissances',
    bootstrapLoading: 'Préparation de votre base de connaissances…',
    selectPromptTitle: 'Sélectionnez une base de connaissances dans la liste',
    renameTooltip: 'Renommer la base de connaissances',
    uploadFiles: 'Téléverser des fichiers',
    rename: 'Renommer',
    deleteBase: 'Supprimer la base',
    deleteBaseTitle: 'Supprimer la base de connaissances',
    deleteBaseConfirm: name => `Voulez-vous vraiment supprimer « ${name} » ? Cette action ne peut pas être annulée.`,
    dropTitle: 'Glissez-déposez vos fichiers ici',
    dropDesc:
      'Importez des documents (HTML, JSON, Markdown, PPTX, DOCX, PDF, TXT, CSV, code…) ou des dossiers entiers pour enrichir votre base de connaissances.',
    emptySharedTitle: 'Cette base partagée ne contient encore aucun fichier',
    uploadFile: 'Téléverser un fichier',
    uploadFolder: 'Téléverser un dossier',
    whatForTitle: 'À quoi sert une base de connaissances ?',
    whatForDesc:
      'Elle vous permet de regrouper vos documents et de les connecter à votre Collaborateur IA. Vous pouvez ensuite interagir avec cette base pour retrouver facilement des informations clés, les analyser et les extraire.',
    selected: count => `${count} sélectionné${count === 1 ? '' : 's'}`,
    restartVectorization: 'Relancer la vectorisation',
    bulkDelete: 'Suppression en masse',
    colFile: 'Fichier',
    colStatus: 'Statut',
    colDate: 'Date de création',
    colSize: 'Taille',
    vectorized: 'Vectorisé',
    vectorizedChunks: count => `Vectorisé, ${count} extrait${count === 1 ? '' : 's'}`,
    uploadingStatus: 'Téléversement…',
    pendingStatus: 'En attente de traitement…',
    processing: 'Traitement…',
    progress: (done, total) => `${done}/${total} lots`,
    skippedPages: pages => `Pages ignorées : ${pages}`,
    failedAt: step => `Échec à l’étape ${step}`,
    errorRef: id => `réf. ${id}`,
    steps: {
      auth: 'vérification de connexion',
      clerk_mint: 'session Unitalk',
      convex_request: 'service de base de connaissances',
      blob_upload: 'envoi du fichier',
      upload_url: 'préparation de l’envoi',
      verify_upload: 'vérification de l’envoi',
      download_url: 'lien de téléchargement',
      download: 'lecture du fichier stocké',
      split_pdf: 'découpage du PDF',
      read_text: 'lecture du texte',
      partition: 'extraction du texte',
      ocr: 'reconnaissance de texte (OCR)',
      extract_text: 'extraction du texte',
      embed: 'vectorisation',
      save_chunks: 'enregistrement des passages',
      qdrant_upsert: 'indexation',
      qdrant_delete: 'nettoyage de l’index',
      search_embed: 'vectorisation de la recherche',
      qdrant_search: 'recherche',
      load_chunks: 'chargement des passages',
      blob_delete: 'suppression du fichier',
      database: 'base de données'
    },
    errorRetry: 'Erreur, réessayer',
    retry: 'Réessayer',
    download: 'Télécharger',
    downloadFailed: 'Impossible de télécharger le fichier',
    delete: 'Supprimer',
    cancel: 'Annuler',
    typeFile: 'Fichier',
    createTitle: 'Créer une base de connaissances',
    baseNamePlaceholder: 'Ma base de connaissances',
    descriptionPlaceholder: 'Description de la base de connaissances (facultatif)',
    create: 'Créer',
    uploading: 'Téléversement…',
    uploadFailed: 'Impossible de téléverser un ou plusieurs fichiers',
    fileTooLarge: 'Certains fichiers ont été ignorés car ils dépassent la limite (PDF 200 Mo, autres 20 Mo).',
    duplicateTitle: 'Déjà présent dans cette base',
    duplicateMessage: count =>
      count === 1
        ? 'Un fichier était déjà présent dans cette base de connaissances.'
        : `${count} fichiers étaient déjà présents dans cette base de connaissances.`,
    retryParseFailed: 'Impossible de relancer le traitement',
    loading: 'Chargement des bases de connaissances…',
    loadFailed: 'Impossible de charger les bases de connaissances',
    filesLoadFailed: 'Impossible de charger les fichiers',
    searchFailed: 'La recherche a échoué',
    signInTitle: 'Connectez-vous à Unitalk',
    signInHint:
      'Les bases de connaissances appartiennent à votre compte Unitalk. Connectez-vous pour les voir et les gérer.',
    signIn: 'Se connecter',
    backendTitle: 'Service des bases de connaissances indisponible',
    backendHint: 'Installez le paquet du plugin knowledge-base puis redémarrez la passerelle.',
    notConfiguredTitle: 'Base de connaissances non configurée',
    notConfiguredHint: 'Définissez KB_CONVEX_SITE_URL pour ce profil Hermes, puis redémarrez la passerelle.',
    unsupportedTitle: 'Mettez à jour Unitalk Desktop',
    unsupportedHint:
      'Cette version de l’application ne peut pas encore partager votre session Unitalk avec les plugins.',
    composerLabel: 'Connaissances',
    composerTitle: "Bases de connaissances pour l'agent",
    composerAllActive: 'Toutes les bases de connaissances',
    composerActiveCount: count => (count === 1 ? '1 base de connaissances' : `${count} bases de connaissances`),
    composerNoneActive: 'Bases de connaissances désactivées',
    composerEmpty: 'Aucune base de connaissances',
    composerSignIn: 'Connectez-vous pour utiliser vos bases de connaissances',
    composerLoadFailed: 'Impossible de charger les bases de connaissances',
    composerManage: 'Gérer les bases de connaissances',
    composerSaveFailed: 'Impossible de mettre à jour les bases actives',
    errors: {
      kb_not_configured: 'La base de connaissances n’est pas configurée sur cette instance Hermes.',
      kb_session_required: 'Connectez-vous à Unitalk pour utiliser vos bases de connaissances.',
      kb_session_invalid: 'Votre session Unitalk a expiré. Reconnectez-vous.',
      kb_organization_unavailable: "Vous n'avez plus accès à cette organisation. Changez d'organisation et réessayez.",
      too_large: 'Le fichier dépasse la limite (PDF 200 Mo, autres 20 Mo).',
      split_required: 'Ce PDF est trop volumineux pour être traité sans être découpé en parties.',
      unsupported_type: 'Ce type de fichier n’est pas pris en charge.',
      duplicate: 'Ce fichier est déjà présent dans la base de connaissances.',
      forbidden: 'Vous n’avez pas l’autorisation d’effectuer cette action.',
      not_found: 'Cet élément n’existe plus.',
      invalid: 'La requête a été refusée.',
      invalid_id: 'La requête a été refusée.',
      empty_file: 'Le fichier est vide.',
      upload_failed: 'Le fichier n’a pas pu être envoyé vers le stockage.',
      upstream: 'Le service des bases de connaissances est indisponible. Réessayez plus tard.'
    }
  }
}

const CSS = `
.kb-composer-btn { width:var(--composer-control-size, 1.75rem); height:var(--composer-control-size, 1.75rem); flex-shrink:0; border-radius:0.375rem; color:var(--ui-text-tertiary); }
.kb-composer-btn:hover, .kb-composer-btn[data-state=open] { background:var(--chrome-action-hover); color:var(--foreground, var(--ui-text-primary)); }
.kb-composer-btn[data-on=true] { color:var(--ui-text-primary); }
.kb-composer-menu { min-width:16rem; max-width:22rem; }
.kb-composer-head { display:flex; flex-direction:column; gap:0.125rem; padding:0.375rem 0.5rem 0.5rem; }
.kb-composer-head strong { font-size:0.78rem; font-weight:600; }
.kb-composer-head span { font-size:0.72rem; color:var(--ui-text-tertiary); }
.kb-composer-item { gap:0.5rem; }
.kb-composer-check { pointer-events:none; }
.kb-composer-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kb-root { display:flex; height:100%; min-height:0; color:var(--ui-text-primary); }
.kb-sidebar { display:flex; flex-direction:column; flex:0 0 17.5rem; min-width:0; border-right:1px solid var(--ui-stroke-quaternary); }
.kb-sidebar-head { display:flex; align-items:center; justify-content:space-between; height:3rem; padding:0 0.5rem 0 1rem; border-bottom:1px solid var(--ui-stroke-quaternary); flex:0 0 auto; }
.kb-sidebar-head h2 { margin:0; font-size:0.875rem; font-weight:600; }
.kb-sidebar-list { flex:1; min-height:0; overflow-y:auto; padding:0.75rem 0.5rem; }
.kb-section-toggle { display:flex; align-items:center; gap:0.375rem; width:100%; padding:0.25rem 0.5rem; margin:0.5rem 0 0.25rem; border:0; background:transparent; color:var(--ui-text-tertiary); font:inherit; font-size:0.72rem; font-weight:500; cursor:pointer; }
.kb-section-toggle:first-child { margin-top:0; }
.kb-section-toggle:hover { color:var(--ui-text-primary); }
.kb-items { display:flex; flex-direction:column; gap:2px; }
.kb-item { display:flex; align-items:center; gap:0.5rem; width:100%; height:2rem; padding:0 0.625rem; border:0; border-radius:0.375rem; background:transparent; color:var(--ui-text-secondary); font:inherit; font-size:0.8125rem; text-align:left; cursor:pointer; }
.kb-item:hover { background:var(--chrome-action-hover); color:var(--ui-text-primary); }
.kb-item[data-selected="true"] { background:var(--chrome-action-hover); color:var(--ui-text-primary); font-weight:500; }
.kb-item span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kb-muted { padding:0.25rem 0.75rem; font-size:0.72rem; color:var(--ui-text-tertiary); }
.kb-detail { position:relative; display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; }
.kb-detail-head { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; height:3rem; padding:0 1.5rem; border-bottom:1px solid var(--ui-stroke-quaternary); flex:0 0 auto; }
.kb-title { display:flex; align-items:center; gap:0.25rem; min-width:0; }
.kb-title h2 { margin:0; font-size:0.875rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kb-badge { margin-left:0.5rem; font-size:0.72rem; color:var(--ui-text-tertiary); white-space:nowrap; }
.kb-rename { display:flex; align-items:center; gap:0.25rem; }
.kb-rename input { width:14rem; }
.kb-actions { display:flex; align-items:center; gap:0.5rem; flex:0 0 auto; }
.kb-progress { display:inline-flex; align-items:center; gap:0.375rem; font-size:0.72rem; color:var(--ui-text-tertiary); }
.kb-center { display:flex; flex:1; flex-direction:column; align-items:center; justify-content:center; gap:0.75rem; padding:1.5rem; text-align:center; font-size:0.8125rem; color:var(--ui-text-secondary); }
.kb-drop-overlay { position:absolute; inset:0; z-index:10; display:flex; align-items:center; justify-content:center; border:2px dashed var(--ui-accent); background:color-mix(in srgb, var(--ui-accent) 6%, transparent); pointer-events:none; font-size:0.8125rem; font-weight:500; }
.kb-empty { display:flex; flex:1; flex-direction:column; align-items:center; justify-content:center; gap:2rem; width:100%; max-width:44rem; margin:0 auto; padding:2rem; }
.kb-dropzone { display:flex; flex-direction:column; align-items:center; gap:0.75rem; width:100%; padding:2.5rem 2rem; border:1px dashed var(--ui-stroke-secondary); border-radius:0.75rem; background:var(--ui-bg-elevated); text-align:center; }
.kb-dropzone-icon { display:grid; place-items:center; width:3rem; height:3rem; border:1px solid var(--ui-stroke-quaternary); border-radius:999px; background:var(--ui-bg-primary); color:var(--ui-text-secondary); }
.kb-dropzone h3 { margin:0; font-size:1rem; font-weight:600; }
.kb-dropzone p { margin:0; max-width:26rem; font-size:0.8125rem; line-height:1.5; color:var(--ui-text-secondary); }
.kb-dropzone-actions { display:flex; gap:0.75rem; margin-top:0.5rem; }
.kb-whatfor { display:flex; align-items:flex-start; gap:0.75rem; max-width:36rem; }
.kb-whatfor-icon { display:grid; place-items:center; flex:0 0 auto; width:2.25rem; height:2.25rem; border-radius:999px; background:color-mix(in srgb, var(--ui-accent) 12%, transparent); color:var(--ui-accent); }
.kb-whatfor h4 { margin:0 0 0.25rem; font-size:0.8125rem; font-weight:600; }
.kb-whatfor p { margin:0; font-size:0.78rem; line-height:1.5; color:var(--ui-text-secondary); }
.kb-table-wrap { flex:1; min-height:0; overflow-y:auto; padding:1.25rem 1.5rem; }
.kb-table { width:100%; border-collapse:collapse; border:1px solid var(--ui-stroke-quaternary); background:var(--ui-bg-elevated); font-size:0.8125rem; }
.kb-table th { height:2.5rem; padding:0 0.75rem; border-bottom:1px solid var(--ui-stroke-quaternary); text-align:left; font-size:0.75rem; font-weight:500; color:var(--ui-text-tertiary); }
.kb-table td { padding:0.625rem 0.75rem; border-bottom:1px solid var(--ui-stroke-quaternary); vertical-align:middle; }
.kb-table tbody tr:last-child td { border-bottom:0; }
.kb-table tbody tr:hover { background:var(--chrome-action-hover); }
.kb-table tr[data-selected="true"] { background:var(--chrome-action-hover); }
.kb-check { width:2.25rem; }
.kb-check-box { opacity:0; transition:opacity .15s; }
.kb-table tr:hover .kb-check-box, .kb-table[data-selecting="true"] .kb-check-box { opacity:1; }
.kb-bulk { display:flex; align-items:center; gap:0.25rem; }
.kb-bulk span { margin-right:0.75rem; font-weight:500; color:var(--ui-text-primary); }
.kb-file { display:flex; align-items:center; gap:0.625rem; min-width:0; }
.kb-file-text { display:flex; flex-direction:column; gap:0.125rem; min-width:0; }
.kb-file-icon { display:grid; place-items:center; flex:0 0 auto; width:1.75rem; height:1.75rem; border-radius:0.375rem; background:color-mix(in srgb, var(--ui-red) 12%, transparent); color:var(--ui-red); }
.kb-file-icon[data-kind="sheet"] { background:color-mix(in srgb, var(--ui-green) 12%, transparent); color:var(--ui-green); }
.kb-file-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:22rem; font-weight:500; }
.kb-file-note { font-size:0.72rem; color:var(--ui-text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:22rem; }
.kb-file-note[data-tone="error"] { color:var(--ui-red); }
.kb-status-cell { width:3.5rem; text-align:center; }
.kb-status { display:inline-grid; place-items:center; width:1.625rem; height:1.625rem; border:0; border-radius:999px; background:var(--ui-bg-tertiary); color:var(--ui-text-secondary); font-size:0.65rem; }
.kb-status[data-tone="ready"], .kb-status[data-tone="busy"] { background:color-mix(in srgb, var(--ui-accent) 12%, transparent); color:var(--ui-accent); }
.kb-status[data-tone="error"] { background:color-mix(in srgb, var(--ui-red) 12%, transparent); color:var(--ui-red); }
button.kb-status { cursor:pointer; }
.kb-menu-cell { width:2.75rem; }
.kb-row-menu { opacity:0; transition:opacity .15s; }
.kb-table tr:hover .kb-row-menu, .kb-row-menu[data-state="open"] { opacity:1; }
.kb-date-cell { width:9rem; color:var(--ui-text-secondary); white-space:nowrap; }
.kb-size-cell { width:6rem; color:var(--ui-text-secondary); white-space:nowrap; }
.kb-danger { color:var(--ui-red); }
.kb-dialog-form { display:flex; flex-direction:column; gap:0.75rem; }
[data-tour="page-tabs"] [data-tour="tab-knowledge-base:bases"] { order:60; }
`

export function fileExtension(name) {
  const parts = String(name || '').split('.')
  if (parts.length < 2) return ''
  return (parts.at(-1) || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isPdfFile(file) {
  return file.type === 'application/pdf' || fileExtension(file.name) === 'pdf'
}

export function maxBytesForFile(file) {
  return isPdfFile(file) ? PDF_MAX_BYTES : OTHER_MAX_BYTES
}

export function fileExceedsSizeLimit(file) {
  return file.size > maxBytesForFile(file)
}

export function asFileList(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.files) ? data.files : []
  return list.filter(item => item && typeof item === 'object' && typeof item.id === 'string')
}

export function isFilePending(file) {
  return PENDING_STATUSES.has(file?.status)
}

export function fileProgress(file) {
  const done = Number(file?.progress?.done)
  const total = Number(file?.progress?.total)
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null
  return { done: Math.min(Math.max(0, done), total), total }
}

export function skippedPagesLabel(file) {
  const pages = Array.isArray(file?.skippedPages) ? file.skippedPages.filter(Number.isFinite) : []
  if (pages.length === 0) return null
  const shown = pages.slice(0, 10).join(', ')
  return pages.length > 10 ? `${shown}… (+${pages.length - 10})` : shown
}

export function isOwnedBase(kb) {
  return !kb?.shared
}

export function canManageBase(kb) {
  return Boolean(kb) && !kb.shared
}

export function shouldBootstrapDefaultKnowledgeBase({ bootstrapInFlight, isCreating, isQueryReady, ownedCount }) {
  if (bootstrapInFlight || isCreating || ownedCount > 0) return false
  return isQueryReady
}

export function pickDefaultKnowledgeBaseId(bases) {
  if (bases.length === 0) return null
  return bases.find(isOwnedBase)?.id ?? bases[0]?.id ?? null
}

export function pickKnowledgeBaseAfterDelete(bases, deletedId) {
  const remaining = bases.filter(kb => kb.id !== deletedId)
  if (remaining.length === 0) return null
  const index = bases.findIndex(kb => kb.id === deletedId)
  if (index === -1) return pickDefaultKnowledgeBaseId(remaining)
  const neighbor = bases[index + 1] ?? bases[index - 1]
  if (neighbor && remaining.some(kb => kb.id === neighbor.id)) return neighbor.id
  return pickDefaultKnowledgeBaseId(remaining)
}

export function normalizeBases(data) {
  const owned = Array.isArray(data?.owned) ? data.owned : []
  const shared = Array.isArray(data?.shared) ? data.shared : []
  const valid = kb => kb && typeof kb === 'object' && typeof kb.id === 'string'
  return {
    owned: owned.filter(valid).map(kb => ({ ...kb, shared: false })),
    shared: shared.filter(valid).map(kb => ({ ...kb, shared: true }))
  }
}

export async function collectDroppedFiles(dataTransfer) {
  const fromEntries = []
  for (const item of Array.from(dataTransfer?.items ?? [])) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) fromEntries.push(...(await readEntry(entry)))
  }
  return fromEntries.length > 0 ? fromEntries : Array.from(dataTransfer?.files ?? [])
}

async function readEntry(entry) {
  if (entry.isFile) return [await new Promise((resolve, reject) => entry.file(resolve, reject))]
  if (!entry.isDirectory) return []
  const reader = entry.createReader()
  const files = []
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    for (const child of batch) files.push(...(await readEntry(child)))
  }
  return files
}

export function errorStatus(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const match = /(?:^|\s|:)([1-5]\d\d): /.exec(message)
  return match ? Number(match[1]) : null
}

function jsonBody(error) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const start = message.indexOf('{')
  if (start < 0) return null
  try {
    const body = JSON.parse(message.slice(start))
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

const textField = (body, key) => (typeof body?.[key] === 'string' && body[key] ? body[key] : null)

export function errorCode(error) {
  return textField(jsonBody(error), 'detail')
}

// Where a request failed ({step, requestId}), as reported by the plugin API next to `detail`.
export function errorTrace(error) {
  const body = jsonBody(error)
  return { requestId: textField(body, 'requestId'), step: textField(body, 'step') }
}

export function stepLabel(t, step) {
  if (!step) return null
  const key = `steps.${step}`
  const text = t(key)
  return text && text !== key ? text : step
}

function withTrace(t, text, error) {
  const { requestId, step } = errorTrace(error)
  const where = [step ? t('failedAt', stepLabel(t, step)) : null, requestId ? t('errorRef', requestId) : null]
    .filter(Boolean)
    .join(', ')
  return where ? `${text} (${where})` : text
}

export function errorMessage(error) {
  const code = errorCode(error)
  if (code) return code
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const stripped = message.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')
  return stripped || 'Something went wrong.'
}

export function localizedError(t, error) {
  const bare = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : null
  const code = errorCode(error) ?? bare
  if (code) {
    const key = `errors.${code}`
    const text = t(key)
    if (text && text !== key) return withTrace(t, text, error)
  }
  return withTrace(t, errorMessage(error), error)
}

// "Failed at embeddings: embeddings 429: …" for a file whose processing failed.
export function fileErrorText(t, file) {
  const label = stepLabel(t, file.errorStep)
  if (!label) return file.error || ''
  return file.error ? `${t('failedAt', label)}: ${file.error}` : t('failedAt', label)
}

export function isSessionError(error) {
  return errorStatus(error) === 428 && SESSION_CODES.has(errorCode(error))
}

export function isNotConfiguredError(error) {
  return errorStatus(error) === 428 && errorCode(error) === 'kb_not_configured'
}

export function createSessionSync(rest, { getToken, getCredentials } = {}) {
  let sentKey = null
  let sentAt = 0
  let pending = Promise.resolve(false)

  async function read(getter) {
    if (typeof getter !== 'function') return null
    try {
      return (await getter()) || null
    } catch {
      return null
    }
  }

  // Desktop: hand the backend Clerk session credentials once; it then mints its own fresh session
  // tokens from Clerk for as long as the session lives. Elsewhere (browser Webapp): push the
  // short-lived session JWT itself whenever Clerk refreshes it.
  async function send(force) {
    const credentials = await read(getCredentials)
    const body = credentials ? { credentials } : { token: await read(getToken) }
    if (!body.credentials && !body.token) return false
    const key = JSON.stringify(body)
    const stale = Boolean(body.credentials) && Date.now() - sentAt > CREDENTIALS_RESEND_MS
    if (!force && !stale && key === sentKey) return true
    await rest('/session', { method: 'PUT', body })
    sentKey = key
    sentAt = Date.now()
    return true
  }

  function push(force = false) {
    pending = send(force).catch(() => false)
    return pending
  }

  async function clear() {
    sentKey = null
    sentAt = 0
    pending = Promise.resolve(false)
    await rest('/session', { method: 'DELETE' })
  }

  return { clear, push, ready: () => pending }
}

export function canShareClerkSession(clerk) {
  return typeof clerk?.getSessionCredentials === 'function' || typeof clerk?.getToken === 'function'
}

export function startSessionSync({ clerk, session, setInterval: every, onDispose }) {
  if (!canShareClerkSession(clerk)) return
  const identity = value => `${value?.status ?? ''}|${value?.user?.id ?? ''}|${value?.activeOrganization?.id ?? ''}`
  const initial = clerk.snapshot?.get?.()
  let last = identity(initial)

  if (initial?.status === 'signed-out') void session.clear().catch(() => undefined)
  else void session.push(true)
  every(() => void session.push(false), SESSION_PUSH_MS)

  const unsubscribe = clerk.snapshot?.listen?.(value => {
    const next = identity(value)
    if (next === last) return
    last = next
    if (value?.status === 'signed-out') {
      void session.clear().catch(() => undefined)
      return
    }
    void session.push(true)
  })
  if (typeof unsubscribe === 'function') onDispose(unsubscribe)
}

export function createKnowledgeApi(rest, session = null) {
  async function call(path, options) {
    if (session) await session.ready()
    try {
      return await rest(path, options)
    } catch (error) {
      if (!session || !isSessionError(error)) throw error
      const pushed = await session.push(true)
      if (!pushed) throw error
      return rest(path, options)
    }
  }

  const base = id => `/bases/${encodeURIComponent(id)}`
  const file = id => `/files/${encodeURIComponent(id)}`

  return {
    config: () => rest('/config'),
    clearSession: async () => {
      if (session) return session.clear()
      await rest('/session', { method: 'DELETE' })
    },
    bases: async () => normalizeBases(await call('/bases')),
    createBase: ({ name, description }) => call('/bases', { method: 'POST', body: { name, description } }),
    renameBase: (id, name) => call(base(id), { method: 'PATCH', body: { name } }),
    deleteBase: id => call(base(id), { method: 'DELETE' }),
    files: id => call(`${base(id)}/files`),
    removeFiles: ids => call('/files/remove', { method: 'POST', body: { ids } }),
    retryFile: id => call(`${file(id)}/retry`, { method: 'POST' }),
    downloadUrl: async id => (await call(`${file(id)}/download`))?.url ?? null,
    search: (query, baseIds) => call('/search', { method: 'POST', body: { query, baseIds } }),
    // Through `call`: after an account or organization switch it waits for the new session, so the
    // backend answers with the new scope's selection, not the previous one.
    activeBases: async () => {
      const result = await call('/active-bases')
      return Array.isArray(result?.baseIds) ? result.baseIds : null
    },
    setActiveBases: async baseIds => {
      const result = await call('/active-bases', { method: 'PUT', body: { baseIds } })
      return Array.isArray(result?.baseIds) ? result.baseIds : null
    },
    uploadFile: async (id, upload) =>
      call(`${base(id)}/files`, {
        method: 'POST',
        timeoutMs: UPLOAD_TIMEOUT_MS,
        upload: { filename: upload.name, contentType: upload.type || undefined, bytes: await upload.arrayBuffer() }
      })
  }
}

export function formatSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date)
}

function isWebUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function fileKind(contentType) {
  const type = String(contentType || '')
  if (type.includes('csv') || type.includes('spreadsheet') || type.includes('excel')) return 'sheet'
  if (type.includes('pdf')) return 'pdf'
  return 'file'
}

function Icon({ name, size = 16 }) {
  const Component = icons[name]
  return Component ? jsx(Component, { size }) : null
}

function CreateKnowledgeDialog({ open, loading, onOpenChange, onCreate }) {
  const t = usePluginI18n(ID)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const reset = () => {
    setName('')
    setDescription('')
  }

  const submit = async event => {
    event.preventDefault()
    if (!name.trim() || loading) return
    const ok = await onCreate(name.trim(), description.trim() || undefined).then(
      () => true,
      () => false
    )
    if (ok) reset()
  }

  return jsx(Dialog, {
    open,
    onOpenChange: next => {
      if (loading) return
      if (!next) reset()
      onOpenChange(next)
    },
    children: jsxs(DialogContent, {
      className: 'sm:max-w-md',
      children: [
        jsx(DialogHeader, { children: jsx(DialogTitle, { children: t('createTitle') }) }),
        jsxs('form', {
          className: 'kb-dialog-form',
          onSubmit: event => void submit(event),
          children: [
            jsx(Input, {
              autoFocus: true,
              disabled: loading,
              onChange: event => setName(event.target.value),
              placeholder: t('baseNamePlaceholder'),
              value: name
            }),
            jsx(Textarea, {
              disabled: loading,
              onChange: event => setDescription(event.target.value),
              placeholder: t('descriptionPlaceholder'),
              value: description
            }),
            jsxs(DialogFooter, {
              children: [
                jsx(Button, {
                  disabled: loading,
                  onClick: () => onOpenChange(false),
                  type: 'button',
                  variant: 'outline',
                  children: t('cancel')
                }),
                jsx(Button, { disabled: !name.trim() || loading, loading, type: 'submit', children: t('create') })
              ]
            })
          ]
        })
      ]
    })
  })
}

function SidebarSection({ title, bases, emptyLabel, icon, selectedId, onSelect }) {
  const [open, setOpen] = useState(true)

  return [
    jsxs(
      'button',
      {
        className: 'kb-section-toggle',
        onClick: () => setOpen(value => !value),
        type: 'button',
        children: [jsx(Icon, { name: open ? 'ChevronDown' : 'ChevronRight', size: 14 }), title]
      },
      `${title}-toggle`
    ),
    open
      ? jsx(
          'div',
          {
            className: 'kb-items',
            children:
              bases.length === 0
                ? jsx('div', { className: 'kb-muted', children: emptyLabel })
                : bases.map(kb =>
                    jsxs(
                      'button',
                      {
                        className: 'kb-item',
                        'data-selected': selectedId === kb.id ? 'true' : 'false',
                        onClick: () => onSelect(kb.id),
                        type: 'button',
                        children: [jsx(Icon, { name: icon, size: 15 }), jsx('span', { children: kb.name })]
                      },
                      kb.id
                    )
                  )
          },
          `${title}-items`
        )
      : null
  ]
}

function KnowledgeListSidebar({ owned, shared, selectedId, onSelect, onCreateClick }) {
  const t = usePluginI18n(ID)

  return jsxs('aside', {
    className: 'kb-sidebar',
    children: [
      jsxs('div', {
        className: 'kb-sidebar-head',
        children: [
          jsx('h2', { children: t('title') }),
          jsx(Tip, {
            label: t('createTitle'),
            children: jsx(Button, {
              'aria-label': t('createTitle'),
              onClick: onCreateClick,
              size: 'icon-sm',
              variant: 'ghost',
              children: jsx(Icon, { name: 'Plus' })
            })
          })
        ]
      }),
      jsxs('div', {
        className: 'kb-sidebar-list',
        children: [
          jsx(SidebarSection, {
            bases: owned,
            emptyLabel: t('noBase'),
            icon: 'Book',
            onSelect,
            selectedId,
            title: t('myBases')
          }),
          shared.length > 0
            ? jsx(SidebarSection, {
                bases: shared,
                emptyLabel: t('noBase'),
                icon: 'Users',
                onSelect,
                selectedId,
                title: t('sharedBases')
              })
            : null
        ]
      })
    ]
  })
}

function statusLabel(t, file) {
  if (file.status === 'uploading') return t('uploadingStatus')
  if (file.status === 'pending') return t('pendingStatus')
  const progress = fileProgress(file)
  return progress ? `${t('processing')} ${t('progress', progress.done, progress.total)}` : t('processing')
}

function StatusBadge({ file, readOnly, onRetry }) {
  const t = usePluginI18n(ID)

  if (file.status === 'ready') {
    const label = Number(file.chunkCount) > 0 ? t('vectorizedChunks', Number(file.chunkCount)) : t('vectorized')
    return jsx(Tip, {
      label,
      children: jsx('span', {
        className: 'kb-status',
        'data-tone': 'ready',
        children: jsx(Icon, { name: 'CheckCircle2', size: 14 })
      })
    })
  }
  if (isFilePending(file)) {
    const label = statusLabel(t, file)
    return jsx(Tip, {
      label,
      children: jsx('span', {
        className: 'kb-status',
        'data-tone': 'busy',
        children: jsx(GlyphSpinner, { ariaLabel: label })
      })
    })
  }
  if (file.status === 'error') {
    const detail = fileErrorText(t, file)
    const label = detail ? `${t('errorRetry')}: ${detail}` : t('errorRetry')
    if (readOnly) {
      return jsx(Tip, {
        label: detail || t('errorRetry'),
        children: jsx('span', {
          className: 'kb-status',
          'data-tone': 'error',
          children: jsx(Icon, { name: 'AlertCircle', size: 14 })
        })
      })
    }
    return jsx(Tip, {
      label,
      children: jsx('button', {
        'aria-label': t('errorRetry'),
        className: 'kb-status',
        'data-tone': 'error',
        onClick: () => onRetry(file.id),
        type: 'button',
        children: jsx(Icon, { name: 'RefreshCw', size: 14 })
      })
    })
  }
  return null
}

function FileNote({ file }) {
  const t = usePluginI18n(ID)

  if (file.status === 'error' && (file.error || file.errorStep)) {
    const detail = fileErrorText(t, file)
    return jsx('span', { className: 'kb-file-note', 'data-tone': 'error', title: detail, children: detail })
  }
  if (file.status === 'processing') {
    const progress = fileProgress(file)
    if (progress)
      return jsx('span', { className: 'kb-file-note', children: t('progress', progress.done, progress.total) })
  }
  const skipped = skippedPagesLabel(file)
  if (skipped) return jsx('span', { className: 'kb-file-note', children: t('skippedPages', skipped) })
  return null
}

function FileRowMenu({ file, readOnly, onDelete, onDownload, onRetry }) {
  const t = usePluginI18n(ID)

  return jsxs(DropdownMenu, {
    children: [
      jsx(DropdownMenuTrigger, {
        asChild: true,
        children: jsx(Button, {
          'aria-label': file.name,
          className: 'kb-row-menu',
          size: 'icon-xs',
          variant: 'ghost',
          children: jsx(Icon, { name: 'MoreHorizontal' })
        })
      }),
      jsxs(DropdownMenuContent, {
        align: 'end',
        children: [
          jsxs(DropdownMenuItem, {
            onSelect: () => onDownload(file.id),
            children: [jsx(Icon, { name: 'Download', size: 14 }), t('download')]
          }),
          !readOnly && file.status === 'error'
            ? jsxs(DropdownMenuItem, {
                onSelect: () => onRetry(file.id),
                children: [jsx(Icon, { name: 'RefreshCw', size: 14 }), t('retry')]
              })
            : null,
          readOnly ? null : jsx(DropdownMenuSeparator, {}),
          readOnly
            ? null
            : jsxs(DropdownMenuItem, {
                className: 'kb-danger',
                onSelect: () => onDelete([file.id]),
                children: [jsx(Icon, { name: 'Trash2', size: 14 }), t('delete')]
              })
        ]
      })
    ]
  })
}

function KnowledgeFilesTable({ files, readOnly, selected, onSelect, onSelectAll, onDelete, onDownload, onRetry }) {
  const t = usePluginI18n(ID)
  const allSelected = files.length > 0 && selected.length === files.length

  return jsx('div', {
    className: 'kb-table-wrap',
    children: jsxs('table', {
      className: 'kb-table',
      'data-selecting': selected.length > 0 ? 'true' : 'false',
      children: [
        jsx('thead', {
          children: jsxs('tr', {
            children: [
              jsx('th', {
                className: 'kb-check',
                children: readOnly
                  ? null
                  : jsx(Checkbox, {
                      'aria-label': t('selected', files.length),
                      checked: allSelected,
                      className: 'kb-check-box',
                      onCheckedChange: value => onSelectAll(value === true ? files.map(file => file.id) : [])
                    })
              }),
              selected.length > 0
                ? jsx('th', {
                    colSpan: 5,
                    children: jsxs('div', {
                      className: 'kb-bulk',
                      children: [
                        jsx('span', { children: t('selected', selected.length) }),
                        jsx(Tip, {
                          label: t('restartVectorization'),
                          children: jsx(Button, {
                            'aria-label': t('restartVectorization'),
                            onClick: () => {
                              for (const id of selected) {
                                const row = files.find(file => file.id === id)
                                if (row?.status === 'error') onRetry(id)
                              }
                            },
                            size: 'icon-xs',
                            variant: 'ghost',
                            children: jsx(Icon, { name: 'RefreshCw' })
                          })
                        }),
                        jsx(Tip, {
                          label: t('bulkDelete'),
                          children: jsx(Button, {
                            'aria-label': t('bulkDelete'),
                            className: 'kb-danger',
                            onClick: () => onDelete(selected),
                            size: 'icon-xs',
                            variant: 'ghost',
                            children: jsx(Icon, { name: 'Trash2' })
                          })
                        })
                      ]
                    })
                  })
                : null,
              ...(selected.length > 0
                ? []
                : [
                    jsx('th', { children: t('colFile') }, 'file'),
                    jsx('th', { className: 'kb-status-cell', children: t('colStatus') }, 'status'),
                    jsx('th', { className: 'kb-menu-cell' }, 'menu'),
                    jsx('th', { className: 'kb-date-cell', children: t('colDate') }, 'date'),
                    jsx('th', { className: 'kb-size-cell', children: t('colSize') }, 'size')
                  ])
            ]
          })
        }),
        jsx('tbody', {
          children: files.map(file => {
            const isSelected = selected.includes(file.id)
            const kind = fileKind(file.contentType)
            return jsxs(
              'tr',
              {
                'data-selected': isSelected ? 'true' : 'false',
                children: [
                  jsx('td', {
                    className: 'kb-check',
                    children: readOnly
                      ? null
                      : jsx(Checkbox, {
                          'aria-label': file.name,
                          checked: isSelected,
                          className: 'kb-check-box',
                          onCheckedChange: value => onSelect(file.id, value === true)
                        })
                  }),
                  jsx('td', {
                    children: jsxs('div', {
                      className: 'kb-file',
                      children: [
                        jsx(Tip, {
                          label: kind === 'sheet' ? 'CSV' : kind === 'pdf' ? 'PDF' : t('typeFile'),
                          children: jsx('span', {
                            className: 'kb-file-icon',
                            'data-kind': kind,
                            children: jsx(Icon, { name: 'FileText', size: 15 })
                          })
                        }),
                        jsxs('div', {
                          className: 'kb-file-text',
                          children: [
                            jsx('span', { className: 'kb-file-name', title: file.name, children: file.name }),
                            jsx(FileNote, { file })
                          ]
                        })
                      ]
                    })
                  }),
                  jsx('td', {
                    className: 'kb-status-cell',
                    children: jsx(StatusBadge, { file, onRetry, readOnly })
                  }),
                  jsx('td', {
                    className: 'kb-menu-cell',
                    children: jsx(FileRowMenu, { file, onDelete, onDownload, onRetry, readOnly })
                  }),
                  jsx('td', { className: 'kb-date-cell', children: formatDate(file.createdAt) }),
                  jsx('td', { className: 'kb-size-cell', children: formatSize(file.size) })
                ]
              },
              file.id
            )
          })
        })
      ]
    })
  })
}

function KnowledgeEmptyState({ disabled, onPickFiles, onPickFolder }) {
  const t = usePluginI18n(ID)

  return jsxs('div', {
    className: 'kb-empty',
    children: [
      jsxs('div', {
        className: 'kb-dropzone',
        children: [
          jsx('span', { className: 'kb-dropzone-icon', children: jsx(Icon, { name: 'Upload', size: 22 }) }),
          jsx('h3', { children: t('dropTitle') }),
          jsx('p', { children: t('dropDesc') }),
          jsxs('div', {
            className: 'kb-dropzone-actions',
            children: [
              jsxs(Button, {
                disabled,
                onClick: onPickFiles,
                type: 'button',
                children: [jsx(Icon, { name: 'Upload', size: 14 }), t('uploadFile')]
              }),
              jsxs(Button, {
                disabled,
                onClick: onPickFolder,
                type: 'button',
                variant: 'outline',
                children: [jsx(Icon, { name: 'FolderOpen', size: 14 }), t('uploadFolder')]
              })
            ]
          })
        ]
      }),
      jsxs('div', {
        className: 'kb-whatfor',
        children: [
          jsx('span', { className: 'kb-whatfor-icon', children: jsx(Icon, { name: 'Brain', size: 18 }) }),
          jsxs('div', {
            children: [jsx('h4', { children: t('whatForTitle') }), jsx('p', { children: t('whatForDesc') })]
          })
        ]
      })
    ]
  })
}

function KnowledgeDetailPanel({
  api,
  bases,
  selectedBase,
  files,
  filesQuery,
  isBootstrapping,
  selectedFiles,
  uploading,
  onCreateClick,
  onRename,
  onDeleteBase,
  onSelectFile,
  onSelectAllFiles,
  onDeleteFiles,
  onDownloadFile,
  onUploadFiles,
  onRetryFile
}) {
  const t = usePluginI18n(ID)
  const [editingName, setEditingName] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInput = useRef(null)
  const folderInput = useRef(null)
  const readOnly = !canManageBase(selectedBase)

  useEffect(() => {
    setEditingName(null)
  }, [selectedBase?.id])

  const pickFiles = () => fileInput.current?.click()
  const pickFolder = () => folderInput.current?.click()

  const handleInput = event => {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (picked.length > 0) onUploadFiles(picked)
  }

  const confirmRename = () => {
    const name = (editingName ?? '').trim()
    if (name && selectedBase && name !== selectedBase.name) onRename(selectedBase.id, name)
    setEditingName(null)
  }

  if (isBootstrapping) {
    return jsxs('div', {
      className: 'kb-center',
      children: [jsx(GlyphSpinner, { ariaLabel: t('bootstrapLoading') }), t('bootstrapLoading')]
    })
  }

  if (bases.length === 0) {
    return jsxs('div', {
      className: 'kb-center',
      children: [
        jsx(EmptyState, { title: t('emptyTitle') }),
        jsx(Button, { onClick: onCreateClick, type: 'button', children: t('emptyAction') })
      ]
    })
  }

  if (!selectedBase) {
    return jsx('div', { className: 'kb-center', children: jsx(EmptyState, { title: t('selectPromptTitle') }) })
  }

  let body
  if (filesQuery.isPending) {
    body = jsx('div', { className: 'kb-center', children: jsx(GlyphSpinner, { ariaLabel: t('loading') }) })
  } else if (filesQuery.isError) {
    body = jsx('div', {
      className: 'kb-center',
      children: jsx(ErrorState, {
        title: t('filesLoadFailed'),
        description: localizedError(t, filesQuery.error),
        children: jsx(Button, {
          onClick: () => void filesQuery.refetch(),
          size: 'sm',
          variant: 'outline',
          children: t('retry')
        })
      })
    })
  } else if (files.length > 0) {
    body = jsx(KnowledgeFilesTable, {
      files,
      onDelete: onDeleteFiles,
      onDownload: onDownloadFile,
      onRetry: onRetryFile,
      onSelect: onSelectFile,
      onSelectAll: onSelectAllFiles,
      readOnly,
      selected: selectedFiles
    })
  } else if (readOnly) {
    body = jsx('div', { className: 'kb-center', children: jsx(EmptyState, { title: t('emptySharedTitle') }) })
  } else {
    body = jsx(KnowledgeEmptyState, { disabled: uploading, onPickFiles: pickFiles, onPickFolder: pickFolder })
  }

  const stop = event => {
    event.preventDefault()
    event.stopPropagation()
  }

  const dropHandlers = readOnly
    ? {}
    : {
        onDragLeave: event => {
          stop(event)
          if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false)
        },
        onDragOver: event => {
          stop(event)
          if (!uploading) setDragActive(true)
        },
        onDrop: event => {
          stop(event)
          setDragActive(false)
          if (uploading) return
          void collectDroppedFiles(event.dataTransfer).then(dropped => {
            if (dropped.length > 0) onUploadFiles(dropped)
          })
        }
      }

  const title = jsxs('div', {
    className: 'kb-title',
    children: [
      jsx('h2', { children: selectedBase.name }),
      readOnly
        ? jsx('span', { className: 'kb-badge', children: t('readOnly') })
        : jsx(Tip, {
            label: t('renameTooltip'),
            children: jsx(Button, {
              'aria-label': t('renameTooltip'),
              onClick: () => setEditingName(selectedBase.name),
              size: 'icon-xs',
              variant: 'ghost',
              children: jsx(Icon, { name: 'Pencil' })
            })
          })
    ]
  })

  const rename = jsxs('div', {
    className: 'kb-rename',
    children: [
      jsx(Input, {
        autoFocus: true,
        onChange: event => setEditingName(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter') confirmRename()
          if (event.key === 'Escape') setEditingName(null)
        },
        value: editingName ?? ''
      }),
      jsx(Button, {
        'aria-label': t('rename'),
        onClick: confirmRename,
        size: 'icon-sm',
        variant: 'ghost',
        children: jsx(Icon, { name: 'Check' })
      }),
      jsx(Button, {
        'aria-label': t('cancel'),
        onClick: () => setEditingName(null),
        size: 'icon-sm',
        variant: 'ghost',
        children: jsx(Icon, { name: 'X' })
      })
    ]
  })

  const actions = readOnly
    ? null
    : jsxs('div', {
        className: 'kb-actions',
        children: [
          uploading
            ? jsxs('span', {
                className: 'kb-progress',
                children: [jsx(GlyphSpinner, { ariaLabel: t('uploading') }), t('uploading')]
              })
            : null,
          jsxs(Button, {
            disabled: uploading,
            onClick: pickFiles,
            type: 'button',
            children: [jsx(Icon, { name: 'Plus', size: 14 }), t('uploadFiles')]
          }),
          jsxs(DropdownMenu, {
            children: [
              jsx(DropdownMenuTrigger, {
                asChild: true,
                children: jsx(Button, {
                  'aria-label': selectedBase.name,
                  size: 'icon-sm',
                  variant: 'ghost',
                  children: jsx(Icon, { name: 'MoreHorizontal' })
                })
              }),
              jsxs(DropdownMenuContent, {
                align: 'end',
                children: [
                  jsx(DropdownMenuItem, { disabled: uploading, onSelect: pickFolder, children: t('uploadFolder') }),
                  jsx(DropdownMenuItem, {
                    onSelect: () => setEditingName(selectedBase.name),
                    children: t('rename')
                  }),
                  jsx(DropdownMenuItem, {
                    className: 'kb-danger',
                    onSelect: () => setConfirmDelete(true),
                    children: t('deleteBase')
                  })
                ]
              })
            ]
          })
        ]
      })

  return jsxs('section', {
    className: 'kb-detail',
    ...dropHandlers,
    children: [
      jsx('input', { hidden: true, multiple: true, onChange: handleInput, ref: fileInput, type: 'file' }),
      jsx('input', {
        hidden: true,
        multiple: true,
        onChange: handleInput,
        ref: node => {
          folderInput.current = node
          if (node) {
            node.setAttribute('webkitdirectory', '')
            node.setAttribute('directory', '')
          }
        },
        type: 'file'
      }),
      dragActive ? jsx('div', { className: 'kb-drop-overlay', children: t('dropTitle') }) : null,
      jsxs('header', {
        className: 'kb-detail-head',
        children: [editingName !== null && !readOnly ? rename : title, actions]
      }),
      body,
      readOnly
        ? null
        : jsx(ConfirmDialog, {
            cancelLabel: t('cancel'),
            confirmLabel: t('delete'),
            description: t('deleteBaseConfirm', selectedBase.name),
            destructive: true,
            onClose: () => setConfirmDelete(false),
            onConfirm: () => onDeleteBase(selectedBase.id),
            open: confirmDelete,
            title: t('deleteBaseTitle')
          })
    ]
  })
}

function useClerkIdentity() {
  const snapshot = useValue(host.clerk?.snapshot ?? NO_SESSION)
  return {
    orgId: snapshot?.activeOrganization?.id ?? null,
    userId: snapshot?.user?.id ?? null
  }
}

/** True when the agent may search `id`: `active === null` means the user never chose (all bases). */
export function isBaseActive(active, id) {
  return active === null || active === undefined || active.includes(id)
}

/** The selection after toggling one base. Starting from "all" materializes the full list; ids of
 *  bases that no longer exist are dropped. Keeps the order the bases are listed in. */
export function nextActiveBases(active, allIds, id, enabled) {
  const current = new Set(active === null || active === undefined ? allIds : active.filter(x => allIds.includes(x)))
  if (enabled) current.add(id)
  else current.delete(id)
  return allIds.filter(x => current.has(x))
}

export function activeSummary(t, active, allIds) {
  if (active === null || active === undefined) return t('composerAllActive')
  const count = active.filter(id => allIds.includes(id)).length
  return count === 0 ? t('composerNoneActive') : t('composerActiveCount', count)
}

/** The composer's Knowledge menu: pick which knowledge bases the agent searches (per profile),
 *  like an assistant's knowledge bases in unitalk.ai. */
export function KnowledgeComposerMenu({ api, canShareSession, navigate, notify }) {
  const t = usePluginI18n(ID)
  const queryClient = useQueryClient()
  const { orgId, userId } = useClerkIdentity()
  const activeKey = [ID, 'active-bases', userId, orgId]

  const configQuery = useQuery({
    queryKey: [ID, 'config'],
    queryFn: () => api.config(),
    retry: false,
    staleTime: 60 * 1000
  })
  const configured = configQuery.data?.configured === true
  const keySession = configQuery.data?.session === true && !canShareSession
  const identified = Boolean(userId) || keySession

  const basesQuery = useQuery({
    enabled: configured && identified,
    queryFn: () => api.bases(),
    queryKey: [ID, 'bases', userId, orgId],
    retry: false
  })
  const activeQuery = useQuery({
    enabled: configured,
    queryFn: () => api.activeBases(),
    queryKey: activeKey,
    retry: false
  })

  const owned = basesQuery.data?.owned ?? []
  const shared = basesQuery.data?.shared ?? []
  const allIds = [...owned, ...shared].map(kb => kb.id)
  const active = activeQuery.data ?? null

  if (!configured) return null

  const toggle = async (id, enabled) => {
    const next = nextActiveBases(active, allIds, id, enabled)
    queryClient.setQueryData(activeKey, next)
    try {
      queryClient.setQueryData(activeKey, await api.setActiveBases(next))
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: activeKey })
      notify({ kind: 'error', message: localizedError(t, error), title: t('composerSaveFailed') })
    }
  }

  const row = (kb, icon) => {
    const checked = isBaseActive(active, kb.id)
    return jsxs(
      DropdownMenuItem,
      {
        'aria-checked': checked,
        className: 'kb-composer-item',
        onSelect: event => {
          event.preventDefault()
          void toggle(kb.id, !checked)
        },
        role: 'menuitemcheckbox',
        children: [
          jsx(Checkbox, { 'aria-hidden': true, checked, className: 'kb-composer-check', tabIndex: -1 }),
          jsx(Icon, { name: icon, size: 14 }),
          jsx('span', { className: 'kb-composer-name', children: kb.name })
        ]
      },
      kb.id
    )
  }

  let body
  if (!identified) {
    body = [jsx(DropdownMenuItem, { disabled: true, children: t('composerSignIn') }, 'signin')]
  } else if (basesQuery.isPending) {
    body = [jsx(DropdownMenuItem, { disabled: true, children: jsx(GlyphSpinner, {}) }, 'loading')]
  } else if (basesQuery.isError) {
    body = [jsx(DropdownMenuItem, { disabled: true, children: t('composerLoadFailed') }, 'error')]
  } else if (allIds.length === 0) {
    body = [jsx(DropdownMenuItem, { disabled: true, children: t('composerEmpty') }, 'empty')]
  } else {
    body = [...owned.map(kb => row(kb, 'Book')), ...shared.map(kb => row(kb, 'Users'))]
  }

  const summary = activeSummary(t, active, allIds)
  const on = identified && allIds.length > 0 && (active === null || active.some(id => allIds.includes(id)))

  return jsxs(DropdownMenu, {
    children: [
      jsx(Tip, {
        label: `${t('composerLabel')}: ${summary}`,
        children: jsx(DropdownMenuTrigger, {
          asChild: true,
          children: jsx(Button, {
            'aria-label': `${t('composerLabel')}: ${summary}`,
            className: 'kb-composer-btn',
            'data-on': on ? 'true' : 'false',
            size: 'icon',
            type: 'button',
            variant: 'ghost',
            children: jsx(Icon, { name: 'Book', size: 14 })
          })
        })
      }),
      jsxs(DropdownMenuContent, {
        align: 'start',
        className: 'kb-composer-menu',
        side: 'top',
        children: [
          jsxs('div', {
            className: 'kb-composer-head',
            children: [jsx('strong', { children: t('composerTitle') }), jsx('span', { children: summary })]
          }),
          ...body,
          jsx(DropdownMenuSeparator, {}),
          jsxs(
            DropdownMenuItem,
            {
              onSelect: () => navigate(MANAGE_ROUTE),
              children: [jsx(Icon, { name: 'Settings2', size: 14 }), t('composerManage')]
            },
            'manage'
          )
        ]
      })
    ]
  })
}

function CenteredState({ title, description, action }) {
  return jsxs('div', {
    className: 'kb-center',
    children: [jsx(EmptyState, { description, title }), action ?? null]
  })
}

export function KnowledgeBaseTab({ api, openExternal, notify, signIn, canShareSession }) {
  const t = usePluginI18n(ID)
  const queryClient = useQueryClient()
  const { orgId, userId } = useClerkIdentity()
  const [selectedId, setSelectedId] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const bootstrapInFlight = useRef(false)
  const bootstrappedScope = useRef(null)
  const scope = [userId, orgId]
  const basesKey = [ID, 'bases', ...scope]

  const configQuery = useQuery({
    queryKey: [ID, 'config'],
    queryFn: () => api.config(),
    retry: false,
    staleTime: 60 * 1000
  })
  const configured = configQuery.data?.configured === true
  const keySession = configQuery.data?.session === true && !canShareSession
  const identified = Boolean(userId) || keySession

  const basesQuery = useQuery({
    enabled: configured && identified,
    queryFn: () => api.bases(),
    queryKey: basesKey,
    retry: false
  })

  const owned = useMemo(() => basesQuery.data?.owned ?? [], [basesQuery.data])
  const shared = useMemo(() => basesQuery.data?.shared ?? [], [basesQuery.data])
  const allBases = useMemo(() => [...owned, ...shared], [owned, shared])
  const selectedBase = allBases.find(kb => kb.id === selectedId) ?? null

  useEffect(() => {
    setSelectedId(current => {
      if (allBases.length === 0) return null
      if (current && allBases.some(kb => kb.id === current)) return current
      return pickDefaultKnowledgeBaseId(allBases)
    })
  }, [allBases])

  useEffect(() => {
    setSelectedFiles([])
  }, [selectedId])

  const filesKey = [ID, 'files', ...scope, selectedId]
  const filesQuery = useQuery({
    enabled: Boolean(selectedId) && basesQuery.isSuccess,
    queryFn: async () => asFileList(await api.files(selectedId)),
    queryKey: filesKey,
    refetchInterval: query => ((query.state.data ?? []).some(isFilePending) ? FILES_POLL_MS : false),
    retry: false
  })
  const files = filesQuery.data ?? []

  const refreshBases = useCallback(() => queryClient.invalidateQueries({ queryKey: [ID, 'bases'] }), [queryClient])
  const refreshFiles = useCallback(() => queryClient.invalidateQueries({ queryKey: [ID, 'files'] }), [queryClient])

  const fail = useCallback(
    (key, error) => notify({ kind: 'error', message: localizedError(t, error), title: t(key) }),
    [notify, t]
  )

  const createBase = useCallback(
    async (name, description, options = {}) => {
      setCreating(true)
      try {
        const created = await api.createBase({ description, name })
        await refreshBases()
        if (created?.id) setSelectedId(created.id)
        setCreateOpen(false)
        if (!options.silent) notify({ kind: 'success', message: name, title: t('created') })
      } catch (error) {
        fail('createFailed', error)
        throw error
      } finally {
        setCreating(false)
      }
    },
    [api, fail, notify, refreshBases, t]
  )

  useEffect(() => {
    const scopeKey = `${userId}|${orgId}`
    if (
      bootstrappedScope.current === scopeKey ||
      !shouldBootstrapDefaultKnowledgeBase({
        bootstrapInFlight: bootstrapInFlight.current,
        isCreating: creating,
        isQueryReady: basesQuery.isSuccess,
        ownedCount: owned.length
      })
    ) {
      return
    }
    bootstrappedScope.current = scopeKey
    bootstrapInFlight.current = true
    setBootstrapping(true)
    void createBase(t('firstKnowledgeBaseName'), undefined, { silent: true })
      .catch(() => undefined)
      .finally(() => {
        bootstrapInFlight.current = false
        setBootstrapping(false)
      })
  }, [basesQuery.isSuccess, createBase, creating, orgId, owned.length, t, userId])

  const renameBase = useCallback(
    (id, name) => {
      void api
        .renameBase(id, name)
        .then(refreshBases)
        .catch(error => fail('renameFailed', error))
    },
    [api, fail, refreshBases]
  )

  const deleteBase = useCallback(
    async id => {
      const next = pickKnowledgeBaseAfterDelete(allBases, id)
      try {
        await api.deleteBase(id)
        setSelectedId(next)
        await refreshBases()
        notify({ kind: 'success', message: '', title: t('deleted') })
      } catch (error) {
        fail('deleteFailed', error)
        throw error
      }
    },
    [allBases, api, fail, notify, refreshBases, t]
  )

  const deleteFiles = useCallback(
    ids => {
      if (ids.length === 0) return
      void api
        .removeFiles(ids)
        .then(() => {
          setSelectedFiles(current => current.filter(id => !ids.includes(id)))
          return Promise.all([refreshFiles(), refreshBases()])
        })
        .catch(error => fail('removeFilesFailed', error))
    },
    [api, fail, refreshBases, refreshFiles]
  )

  const retryFile = useCallback(
    id => {
      void api
        .retryFile(id)
        .then(refreshFiles)
        .catch(error => fail('retryParseFailed', error))
    },
    [api, fail, refreshFiles]
  )

  const downloadFile = useCallback(
    id => {
      void api
        .downloadUrl(id)
        .then(url => {
          if (!isWebUrl(url)) throw new Error('upstream')
          return openExternal(url)
        })
        .catch(error => fail('downloadFailed', error))
    },
    [api, fail, openExternal]
  )

  const uploadFiles = useCallback(
    async incoming => {
      if (!selectedId || incoming.length === 0 || uploading) return
      setUploading(true)
      let uploaded = 0
      let duplicates = 0
      let tooLarge = 0
      try {
        for (const file of incoming) {
          if (fileExceedsSizeLimit(file)) {
            tooLarge += 1
            continue
          }
          try {
            const result = await api.uploadFile(selectedId, file)
            if (result?.duplicate) duplicates += 1
            else uploaded += 1
          } catch (error) {
            if (errorStatus(error) === 413 && errorCode(error) === 'too_large') {
              tooLarge += 1
              continue
            }
            fail('uploadFailed', error)
          }
        }
        if (uploaded > 0) await Promise.all([refreshFiles(), refreshBases()])
        if (duplicates > 0) {
          notify({ kind: 'info', message: t('duplicateMessage', duplicates), title: t('duplicateTitle') })
        }
        if (tooLarge > 0) notify({ kind: 'error', message: t('fileTooLarge'), title: t('uploadFailed') })
      } finally {
        setUploading(false)
      }
    },
    [api, fail, notify, refreshBases, refreshFiles, selectedId, t, uploading]
  )

  if (configQuery.isPending) {
    return jsxs('div', {
      className: 'kb-center',
      children: [jsx(GlyphSpinner, { ariaLabel: t('loading') }), t('loading')]
    })
  }

  if (configQuery.isError) {
    return jsx(CenteredState, {
      action: jsx(Button, {
        onClick: () => void configQuery.refetch(),
        size: 'sm',
        type: 'button',
        variant: 'outline',
        children: t('retry')
      }),
      description: t('backendHint'),
      title: t('backendTitle')
    })
  }

  if (!configured || isNotConfiguredError(basesQuery.error)) {
    return jsx(CenteredState, { description: t('notConfiguredHint'), title: t('notConfiguredTitle') })
  }

  if (!canShareSession && !keySession) {
    return jsx(CenteredState, { description: t('unsupportedHint'), title: t('unsupportedTitle') })
  }

  if (!identified || isSessionError(basesQuery.error)) {
    return jsx(CenteredState, {
      action: signIn
        ? jsx(Button, { onClick: () => void signIn(), size: 'sm', type: 'button', children: t('signIn') })
        : jsx(Button, {
            onClick: () => void basesQuery.refetch(),
            size: 'sm',
            type: 'button',
            variant: 'outline',
            children: t('retry')
          }),
      description: t('signInHint'),
      title: t('signInTitle')
    })
  }

  if (basesQuery.isPending) {
    return jsxs('div', {
      className: 'kb-center',
      children: [jsx(GlyphSpinner, { ariaLabel: t('loading') }), t('loading')]
    })
  }

  if (basesQuery.isError) {
    return jsx('div', {
      className: 'kb-center',
      children: jsx(ErrorState, {
        title: t('loadFailed'),
        description: localizedError(t, basesQuery.error),
        children: jsx(Button, {
          onClick: () => void basesQuery.refetch(),
          size: 'sm',
          variant: 'outline',
          children: t('retry')
        })
      })
    })
  }

  return jsxs('div', {
    className: 'kb-root',
    children: [
      jsx(KnowledgeListSidebar, {
        onCreateClick: () => setCreateOpen(true),
        onSelect: setSelectedId,
        owned,
        selectedId,
        shared
      }),
      jsx(KnowledgeDetailPanel, {
        api,
        bases: allBases,
        files,
        filesQuery,
        isBootstrapping: bootstrapping || (owned.length === 0 && creating),
        onCreateClick: () => setCreateOpen(true),
        onDeleteBase: deleteBase,
        onDeleteFiles: deleteFiles,
        onDownloadFile: downloadFile,
        onRename: renameBase,
        onRetryFile: retryFile,
        onSelectAllFiles: setSelectedFiles,
        onSelectFile: (id, value) =>
          setSelectedFiles(current =>
            value ? [...new Set([...current, id])] : current.filter(fileId => fileId !== id)
          ),
        onUploadFiles: incoming => void uploadFiles(incoming),
        selectedBase,
        selectedFiles,
        uploading
      }),
      jsx(CreateKnowledgeDialog, {
        loading: creating,
        onCreate: (name, description) => createBase(name, description),
        onOpenChange: setCreateOpen,
        open: createOpen
      })
    ]
  })
}

export default {
  id: ID,
  name: 'Knowledge Base',
  description: 'Create Unitalk knowledge bases, upload documents and let the agent search them.',
  register(ctx) {
    ctx.i18n.register(LOCALES)

    const style = document.createElement('style')
    style.dataset.plugin = ID
    style.textContent = CSS
    document.head.append(style)
    ctx.onDispose(() => style.remove())

    const clerk = host.clerk
    const canShareSession = canShareClerkSession(clerk)
    const session = canShareSession
      ? createSessionSync(ctx.rest, {
          getCredentials:
            typeof clerk.getSessionCredentials === 'function' ? () => clerk.getSessionCredentials() : undefined,
          getToken: typeof clerk.getToken === 'function' ? () => clerk.getToken() : undefined
        })
      : null

    if (session) {
      startSessionSync({ clerk, onDispose: ctx.onDispose, session, setInterval: ctx.setInterval })
    }

    const api = createKnowledgeApi(ctx.rest, session)
    const notify = ({ kind, message, title }) => host.notify({ kind, message, title })
    const signIn = typeof clerk?.signIn === 'function' ? () => clerk.signIn() : null

    ctx.register({
      area: CAPABILITIES_TABS_AREA,
      id: 'bases',
      order: 200,
      render: () =>
        jsx(KnowledgeBaseTab, {
          api,
          canShareSession,
          notify,
          openExternal: url => ctx.os.openExternal(url),
          signIn
        }),
      title: ctx.i18n.t('tabTitle')
    })
    ctx.register({
      area: COMPOSER_LEADING_AREA,
      id: 'composer-menu',
      order: 300,
      render: () =>
        jsx(KnowledgeComposerMenu, {
          api,
          canShareSession,
          navigate: path => (typeof host.navigate === 'function' ? host.navigate(path) : undefined),
          notify
        })
    })
  }
}
