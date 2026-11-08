import { LangDict } from './default'

// en_US only for now. The dictionary in default.ts is regenerated from the source by
// gen-i18n-dict.py, which re-indexes it; that is safe only while this is empty. Once real
// translations exist, the indices are the join key and must be kept.
export default {} satisfies Record<string, LangDict>
