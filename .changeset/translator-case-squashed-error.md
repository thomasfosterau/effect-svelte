---
"@thomasfosterau/effect-sveltekit": patch
---

`KitTranslatorCase` (the cases of `SvelteKit.makeTranslator`) and `FormErrorMapper` (the `formError` option of the remote form wrappers) now type their `error` argument as `ReturnType<typeof Cause.squash>`, and their documentation says what that is: the squashed failure of the handler's `Cause` (its typed failure, a defect or an interruption error). The type is still `unknown`, so existing cases and mappers compile unchanged.
