## New Functions

### Add `deburr` function [→ PR #449](https://github.com/radashi-org/radashi/pull/449)

Normalize accented Latin text into plain ASCII-friendly strings. `deburr` strips combining marks and expands common extended Latin letters and ligatures, which is useful before slugging, searching, or comparing user-facing text.

- Removes Unicode combining marks after NFD normalization
- Handles common Latin characters that do not decompose cleanly, like `Æ`, `ø`, `ß`, and `Ł`
- Leaves other characters untouched, so it stays focused on transliterating Latin text

```ts
import * as _ from 'radashi'

_.deburr('Crème Brûlée') // => 'Creme Brulee'
_.deburr('Ærøskøbing') // => 'Aeroskobing'
_.deburr('Straße') // => 'Strasse'
```

Thanks to [Alec Larson](https://github.com/aleclarson) for adding this string helper!

[Docs](https://radashi.js.org/reference/string/deburr) / [Source](https://github.com/radashi-org/radashi/blob/main/src/string/deburr.ts) / [Tests](https://github.com/radashi-org/radashi/blob/main/tests/string/deburr.test.ts)

### Add `getErrorMessage` function [→ PR #466](https://github.com/radashi-org/radashi/pull/466)

Turn unknown caught values into a readable message that is safe to display or log. `getErrorMessage` returns messages from `Error` instances and non-empty strings, then falls back to `"Unknown error."` for empty or unsupported values.

- Works with `Error` subclasses such as `TypeError`
- Accepts string throws without wrapping them first
- Keeps arbitrary objects from being treated as errors just because they have a `message` property

```ts
import * as _ from 'radashi'

try {
  throw new Error('Request failed')
} catch (error) {
  _.getErrorMessage(error) // => 'Request failed'
}

_.getErrorMessage('Request failed') // => 'Request failed'
_.getErrorMessage(null) // => 'Unknown error.'
```

Thanks to [Alec Larson](https://github.com/aleclarson) for making thrown values easier to handle!

[Docs](https://radashi.js.org/reference/typed/getErrorMessage) / [Source](https://github.com/radashi-org/radashi/blob/main/src/typed/getErrorMessage.ts) / [Tests](https://github.com/radashi-org/radashi/blob/main/tests/typed/getErrorMessage.test.ts)
