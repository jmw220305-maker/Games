// Sammel-Export der Spiellogik für die UI.
export * from './run.js';
export { HANDS, HAND_ORDER, detectHands, handBase, contains } from './hands.js';
export { TALISMANS, TALISMAN_IDS, RARITY_NAMES, sellValue as talismanSellValue } from './content/talismans.js';
export { CONSUMABLES, CONSUMABLE_IDS, consumableSellValue } from './content/consumables.js';
export { WARDENS, WARDEN_IDS } from './content/wardens.js';
export { VOUCHERS, VOUCHER_IDS } from './content/vouchers.js';
export { PACKS, PACK_IDS } from './content/packs.js';
export { TAGS, TAG_IDS } from './content/tags.js';
export { CUPS, CUP_IDS } from './content/cups.js';
export { STAKES, STAKE_IDS, MAX_STAKE, stakeRules } from './content/stakes.js';
export { ACHIEVEMENTS, ACHIEVEMENT_IDS } from './content/achievements.js';
export { MARK_INFO, MATERIAL_INFO, BLIND_NAMES, ANTES_TO_WIN } from './constants.js';
export { blindTarget, cashoutBreakdown } from './economy.js';
export * as meta from './meta.js';

import * as hands from './hands.js';
import * as talismans from './content/talismans.js';
import * as consumables from './content/consumables.js';
import * as wardens from './content/wardens.js';
import * as vouchers from './content/vouchers.js';
import * as packs from './content/packs.js';
import * as tags from './content/tags.js';
import * as cups from './content/cups.js';
import * as stakes from './content/stakes.js';
import * as achievements from './content/achievements.js';
import * as constants from './constants.js';

/** Alle Inhalte gebündelt. */
export const content = {
  HANDS: hands.HANDS,
  TALISMANS: talismans.TALISMANS,
  CONSUMABLES: consumables.CONSUMABLES,
  WARDENS: wardens.WARDENS,
  VOUCHERS: vouchers.VOUCHERS,
  PACKS: packs.PACKS,
  TAGS: tags.TAGS,
  CUPS: cups.CUPS,
  STAKES: stakes.STAKES,
  ACHIEVEMENTS: achievements.ACHIEVEMENTS,
  MARK_INFO: constants.MARK_INFO,
  MATERIAL_INFO: constants.MATERIAL_INFO,
};
