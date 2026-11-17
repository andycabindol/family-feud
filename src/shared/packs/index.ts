import type { Pack } from '../types';
import { thanksgiving } from './thanksgiving';
import { general } from './general';
import { christmas } from './christmas';
import { family } from './family';
import { food } from './food';
import { popculture } from './popculture';
import { kids } from './kids';

/** Order matters: this is how themes appear in the picker. */
export const BUILT_IN_PACKS: Pack[] = [general, thanksgiving, christmas, family, food, popculture, kids];

export const DEFAULT_THEME_ID = 'thanksgiving';
