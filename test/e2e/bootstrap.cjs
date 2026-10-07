const fs = require('node:fs');
module.exports = async () => {
  const { UserModel, DomainModel } = require('hydrooj');
  const suffix = require('node:crypto').randomBytes(5).toString('hex');
  const password = require('node:crypto').randomBytes(24).toString('hex');
  const domain = 'cftrain-e2e-' + suffix;
  const coach = 'cfcoach' + suffix;
  const student = 'cfstudent' + suffix;
  const coachId = await UserModel.create(coach + '@example.invalid', coach, password);
  const studentId = await UserModel.create(student + '@example.invalid', student, password);
  await DomainModel.add(domain, coachId, 'CF plugin integration test', 'Temporary automated test');
  await DomainModel.setUserRole(domain, studentId, 'default', true);
  fs.writeFileSync('/tmp/cf-training-e2e.json', JSON.stringify({domain, coach, student, coachId, studentId, password}), {mode:0o600});
  return {domain, coachId, studentId};
};
