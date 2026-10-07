'use strict';

// Persistent domain-role bit: never allocate dynamically or change after deployment.
const PERM_CF_TRAINING_COACH = 1n << 100n;
function registerCoachPermission(ctx, builtin) {
  const { PERM, PERMS, PERMS_BY_FAMILY, Permission } = builtin;
  if (Object.values(PERM).some(value => value === PERM_CF_TRAINING_COACH)
    || PERMS.some(p => (p.key & PERM_CF_TRAINING_COACH) !== 0n)) {
    throw new Error('CF training permission bit 100 is already registered');
  }
  const entry = Permission('perm_cf_training', PERM_CF_TRAINING_COACH, 'Manage CF training');
  const family = PERMS_BY_FAMILY.perm_cf_training ||= [];
  PERMS.push(entry);
  family.push(entry);
  ctx.on('dispose', () => {
    const index = PERMS.indexOf(entry);
    if (index >= 0) PERMS.splice(index, 1);
    const familyIndex = family.indexOf(entry);
    if (familyIndex >= 0) family.splice(familyIndex, 1);
    if (!family.length) delete PERMS_BY_FAMILY.perm_cf_training;
  });
}
module.exports = { PERM_CF_TRAINING_COACH, registerCoachPermission };
