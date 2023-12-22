# How to contribute to Colyseus

## Working on Colyseus source files

- Clone the repository: `git clone git@github.com:colyseus/colyseus.git`
- Make sure to use Node.js LTS version
- Colyseus uses `pnpm` as package manager. Install dependencies with `pnpm install`.
- Build packages: `pnpm build` (rebuild after any code change & before testing)
- To run the test suite: `pnpm test`

Observations:

- The Colyseus project has multiple packages. They are all under `packages/` folder.
- We use [Lerna](https://github.com/lerna/lerna) for managing the multiple packages.
- Packages that have a `"build"` script are not going to be built with `rollup` (e.g. @colyseus/monitor)

Publishing:

For publishing the packages, run `pnpm -r publish`

---

## **Reporting an issue**

- **Do not open up a GitHub issue if the bug is a security vulnerability in Colyseus**, and instead send us an email at [endel@colyseus.io](endel@colyseus.io).
- **Ensure the issue was not already reported** by searching on GitHub under [Issues](https://github.com/colyseus/colyseus/issues).
- If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/colyseus/colyseus/issues/new). Be sure to include a **title and clear description**, as much relevant information as possible, and a **code sample** or an **executable test case** demonstrating the expected behavior that is not occurring.

## **Did you write a patch that fixes a bug?**

- Open a new GitHub pull request with the patch.
- Ensure the PR description clearly describes the problem and solution. Include the relevant issue number if applicable.
- Before submitting, make sure the tests are still passing, by running `npm test`.

## **Did you fix whitespace, format code, or make a purely cosmetic patch?**

Changes that are cosmetic in nature and do not add anything substantial to the stability, functionality, or testability of Colyseus will generally not be accepted.

## **Do you have questions about the source code?**

- Ask any question about how to use Colyseus on our [Discord Community](https://discord.gg/RY8rRS7).

---
