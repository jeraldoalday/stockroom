// Every quantity/price/cost column in schema.prisma is a plain Postgres
// `Int` (int4, max 2,147,483,647), not `BigInt`. Zod's `.int()` only checks
// that a number has no fractional part — it says nothing about magnitude —
// so a value like 99999999999 sails through validation and then crashes
// the write with a raw, unhandled `PrismaClientUnknownRequestError`
// ("Unable to fit integer value ... into an INT4"), which
// `errorHandler.ts` has no translation for and reports as a bare 500.
// Every schema that feeds an `Int` column chains `.max(MAX_INT4)` to turn
// that crash into an ordinary 400 instead.
export const MAX_INT4 = 2_147_483_647;
