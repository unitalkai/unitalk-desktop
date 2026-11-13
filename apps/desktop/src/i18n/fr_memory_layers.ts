import type { MemoryLayersTranslations } from './types_memory_layers'

export const frMemoryLayers: MemoryLayersTranslations = {
  activeProvider: 'Fournisseur de mémoire actif',
  selectedProvider: 'Fournisseur de mémoire sélectionné',
  selectedDesc: current =>
    `Pas encore actif : les sessions continuent d’utiliser ${current} jusqu’à l’enregistrement de ce choix.`,
  builtinMemory: 'la mémoire intégrée seule',
  noProvider: 'Aucun — mémoire intégrée uniquement',
  noProviderDesc:
    'Unitalk utilise uniquement la mémoire intégrée ci-dessous. Vous pouvez également connecter un fournisseur de mémoire externe dans Paramètres > Mémoire et contexte.',
  providerDesc: name => `${name} ajoute son propre rappel à chaque session, en plus de la couche intégrée.`,
  providerNotReadyDesc: name =>
    `${name} est le fournisseur enregistré, mais n’apporte aucun rappel tant qu’il n’est pas prêt. La couche intégrée fonctionne dans tous les cas.`,
  providerUnknownDesc: name => `${name} est le fournisseur enregistré ; Unitalk n’a pas pu lire s’il est prêt.`,
  statusUnavailable: 'État de la mémoire indisponible',
  statusUnavailableDesc: 'Impossible de lire quel fournisseur de mémoire est actif ni s’il est prêt.',
  retry: 'Réessayer',
  status: {
    ready: 'prêt',
    needs_config: 'configuration requise',
    unavailable: 'indisponible',
    missing: 'non installé'
  },
  builtinLayer: 'Mémoire intégrée',
  onByDefault: 'Activée par défaut',
  on: 'Activée',
  off: 'Désactivée',
  onlyFile: file => `${file} uniquement`,
  builtinDesc:
    'MEMORY.md et USER.md sont la mémoire propre de Unitalk, indépendante de tout fournisseur externe. Les deux sont chargées dans les sessions par défaut et peuvent être désactivées individuellement. Tout fournisseur de mémoire externe vient compléter cette mémoire intégrée, sans la remplacer.'
}
