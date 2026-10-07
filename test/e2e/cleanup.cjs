'use strict';
const fs = require('node:fs');
module.exports = async () => {
  const { db, DomainModel, TokenModel, UserModel, PRIV } = require('hydrooj');
  const cfg = JSON.parse(fs.readFileSync('/tmp/cf-training-e2e.json'));
  if (!/^cftrain-e2e-[a-f0-9]+$/.test(cfg.domain)) throw new Error('Not a test domain');
  for (const [id, uname] of [[cfg.coachId, cfg.coach], [cfg.studentId, cfg.student]]) {
    const user = await db.collection('user').findOne({ _id: id, uname, mail: `${uname}@example.invalid` });
    if (!user) throw new Error('Fixture user identity mismatch; refusing cleanup');
  }
  await DomainModel.del(cfg.domain);
  await db.collection('cftrain_state').deleteOne({ _id: cfg.domain });
  await db.collection('cftrain_job').deleteMany({ domainId: cfg.domain });
  await db.collection('cftrain_submission').deleteMany({ account: `${cfg.domain}-binding` });
  const snapshot = `${cfg.domain}-snapshot`;
  await db.collection('cftrain_reference').deleteMany({ $or: [{ _id: snapshot }, { snapshot }] });
  await db.collection('cftrain_catalog').deleteMany({
    _id: { $in: ['contest:99001', 'problem:99001/A', 'problem:99002/A'] },
    'data.name': 'AUTOMATED TEST FIXTURE',
  });
  for (const [id, uname] of [[cfg.coachId, cfg.coach], [cfg.studentId, cfg.student]]) {
    await UserModel.setPriv(id, PRIV.PRIV_NONE);
    await TokenModel.delByUid(id);
    await db.collection('domain.user').deleteMany({ uid: id });
    await db.collection('user').deleteOne({ _id: id, uname });
  }
  fs.unlinkSync('/tmp/cf-training-e2e.json');
  return { removedTestDomain: cfg.domain, removedTestUsers: [cfg.coachId, cfg.studentId] };
};
