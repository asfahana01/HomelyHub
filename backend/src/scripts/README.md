# Backend scripts

Scripts here provide repository checks and a privileged admin-maintenance
command. Run the package-script checks from `backend/`; do not run the admin
promoter against a production database without confirming the target and
operator authorization.

## Direct files

- [`checkEnvExample.js`](checkEnvExample.js) — verifies the environment example
  against the required variable-name declarations.
- [`checkJavaScript.js`](checkJavaScript.js) — syntax-checks the backend
  JavaScript source files.
- [`promoteAdmin.js`](promoteAdmin.js) — administrative command to promote a
  user using the configured database. Review its source and target environment
  before use; this README does not certify its operational safety in a live
  deployment.

`npm run check:env` and `npm run check:syntax` invoke the first two scripts.
There is no package script declared for `promoteAdmin.js`.

Parent: [`src/`](../README.md). See the [backend commands](../../README.md#run-and-check)
and [environment variable names](../../README.md#configuration-names).
