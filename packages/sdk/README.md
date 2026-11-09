<div align="center">
  <a href="https://github.com/colyseus/colyseus">
    <img src="https://github.com/colyseus/colyseus/blob/master/media/logo.svg?raw=true" width="40%" height="100" />
  </a>
  <br>
  <br>
  <a href="https://npmjs.com/package/colyseus">
    <img src="https://img.shields.io/npm/dm/colyseus.svg?style=for-the-badge&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAAmJLR0QAAKqNIzIAAAAJcEhZcwAADsQAAA7EAZUrDhsAAAAHdElNRQfjAgETESWYxR33AAAAtElEQVQoz4WQMQrCQBRE38Z0QoTcwF4Qg1h4BO0sxGOk80iCtViksrIQRRBTewWxMI1mbELYjYu+4rPMDPtn12ChMT3gavb4US5Jym0tcBIta3oDHv4Gwmr7nC4QAxBrCdzM2q6XqUnm9m9r59h7Rc0n2pFv24k4ttGMUXW+sGELTJjSr7QDKuqLS6UKFChVWWuFkZw9Z2AAvAirKT+JTlppIRnd6XgaP4goefI2Shj++OnjB3tBmHYK8z9zAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDE5LTAyLTAxVDE4OjE3OjM3KzAxOjAwGQQixQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAxOS0wMi0wMVQxODoxNzozNyswMTowMGhZmnkAAAAZdEVYdFNvZnR3YXJlAHd3dy5pbmtzY2FwZS5vcmeb7jwaAAAAAElFTkSuQmCC">
  </a>
  <a href="https://discord.gg/RY8rRS7">
    <img src="https://img.shields.io/discord/525739117951320081.svg?style=for-the-badge&colorB=7581dc&logo=discord&logoColor=white">
  </a>
  <h3>
     Multiplayer SDK for JavaScript/TypeScript. <br /><a href="https://docs.colyseus.io/client">View documentation</a>
  <h3>
</div>

**Browser support tested with:**

<a href="https://www.browserstack.com/"><img src="media/browserstack-logo.png?raw=true" width="300" /></a>

## Publishing to the Cocos Store

The Cocos Creator 3 extension (`cocos-creator-3-extension/`) is listed as [Colyseus Multiplayer SDK](https://store.cocos.com/app/en/detail/5086). The Store has no upload API and its login has a captcha, so submitting runs locally, not in CI.

1. Build the extension package:

   ```sh
   npm run build && npm run build-release-assets
   ```

   This writes `colyseus-sdk-cocos-creator.zip`, with the extension's version taken from this package. CI attaches the same zip to the GitHub release.

2. Fill in the new version on the seller portal:

   ```sh
   npm run submit-cocos-store
   ```

   This opens Google Chrome on the portal. The first time, log in to the Cocos developer center; the session is kept in `~/.colyseus/cocos-store-chrome` for later runs. The script uploads the zip, sets the version number, copies the minimum Creator version from the current Store version, and fills the release notes from this version's `CHANGELOG.md` section (trimmed to the Store's 1500-character limit).

3. Review the form, click **Save And Preview**, then submit the version for review.

Pass `-- --submit` to save and submit without the manual step. Other options: `--notes`, `--notes-cn`, `--requirement` and `--zip` (see the header of `cocos-creator-3-extension/submit-to-store.mjs`).

Cocos reviews each version by hand, which can take up to 3 business days. Once approved, it becomes the current version on the Store.

## License

MIT
