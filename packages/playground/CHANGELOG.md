# Changelog

## 0.17.13

- Message and endpoint schemas from any Standard Schema library are now rendered as forms — zod, Effect, arktype, valibot, sury. Non-zod validators used to throw `Cannot read properties of undefined (reading 'def')` and block the room join. Thanks @ColaFanta! [#955](https://github.com/colyseus/colyseus/issues/955)

## 0.17.12

- Make `zod` an optional peer dependency

## 0.17.11

- Fix memory leaks inspecting rooms

## 0.17.10

- Initial changelog entry

