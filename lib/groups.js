'use strict';
const { randomUUID } = require('node:crypto');
const c = require('./core');

class GroupAccessDenied extends Error {}
const owns = (g, actor) => g.ownerId === actor;
const manages = (g, actor, root = false) => root || owns(g, actor) || !!g.ownerId && (g.adminIds || []).includes(actor);
const sees = (g, actor, root = false) => manages(g, actor, root) || g.uids.includes(actor);
const ownerOnly = (g, actor, root) => { if (!root && !owns(g, actor)) throw new GroupAccessDenied(); };
function members(value) {
  if (!Array.isArray(value) || value.length > 100) c.fail('每班最多 100 名学生');
  return [...new Set(value.map(uid => c.integer(uid, 1, 2 ** 31 - 1, '用户 ID')))];
}
function view(g, actor, root) {
  const manage = manages(g, actor, root), owner = root || owns(g, actor);
  return { id: g.id, name: g.name, uids: sees(g, actor, root) ? g.uids : [],
    ownerId: g.ownerId || null, version: g.version || 0, canManage: manage, canOwn: owner,
    member: g.uids.includes(actor),
    ...(manage ? { adminIds: g.adminIds || [] } : {}),
    ...(owner || g.transfer?.to === actor ? { transfer: g.transfer || null } : {}) };
}

// Called inside the state's compare-and-swap retry: authorization is always checked on fresh state.
async function changeGroup(s, a, { actor, coach, root, validateUser }) {
  let g = s.groups.find(x => x.id === a.id);
  const action = a.action;
  const target = async () => {
    const uid = c.integer(a.uid, 1, 2 ** 31 - 1, '用户 ID');
    await validateUser(uid);
    return uid;
  };
  const checkMembers = value => {
    const uids = members(value);
    if (uids.some(uid => !s.accounts.some(x => x.uid === uid))) c.fail('名单含未绑定 CF 账号的学生');
    return uids;
  };
  let touched = [];
  if (action === 'group' && !a.id) {
    if (!coach && !root) throw new GroupAccessDenied();
    g = { id: randomUUID(), ownerId: actor, adminIds: [], uids: [], version: 0 };
    s.groups.push(g);
  } else if (action === 'group_members') {
    if (!Array.isArray(a.ids) || !a.ids.length || a.ids.length > 100) c.fail('请选择 1—100 个班级');
    touched = [...new Set(a.ids)].map(id => {
      const group = s.groups.find(x => x.id === id);
      if (!group || !manages(group, actor, root)) throw new GroupAccessDenied();
      return group;
    });
    const uids = a.mode === 'remove' ? members(a.uids) : checkMembers(a.uids);
    if (!uids.length || !['add', 'remove'].includes(a.mode)) c.fail('请选择学生和添加或移除操作');
    const next = touched.map(group => members(a.mode === 'add'
      ? [...new Set([...group.uids, ...uids])] : group.uids.filter(uid => !uids.includes(uid))));
    touched.forEach((group, i) => { group.uids = next[i]; });
  } else if (!g) throw new GroupAccessDenied();

  if (action === 'group') {
    if (!manages(g, actor, root)) throw new GroupAccessDenied();
    if (a.id && a.version !== (g.version || 0)) c.fail('班级已被修改，请刷新后重试');
    const name = String(a.name || '').trim();
    if (!name || name.length > 100) c.fail('请输入 1—100 字符的班级名称');
    g.name = name; g.uids = checkMembers(a.uids);
  } else if (action === 'group_rename') {
    if (!manages(g, actor, root)) throw new GroupAccessDenied();
    if (a.version !== (g.version || 0)) c.fail('班级已被修改，请刷新后重试');
    const name = String(a.name || '').trim();
    if (!name || name.length > 100) c.fail('请输入 1—100 字符的班级名称');
    g.name = name;
  } else if (action === 'delete_group') {
    ownerOnly(g, actor, root);
    s.groups = s.groups.filter(x => x.id !== g.id);
  } else if (action === 'group_admin') {
    ownerOnly(g, actor, root);
    if (!g.ownerId) c.fail('请先指定班级所有者');
    if (!['add', 'remove'].includes(a.mode)) c.fail('未知授权操作');
    // Revocation must remain possible after the target leaves the domain or is deleted.
    const uid = a.mode === 'add' ? await target() : c.integer(a.uid, 1, 2 ** 31 - 1, '用户 ID');
    if (uid === g.ownerId) c.fail('所有者无需重复授予管理员权限');
    g.adminIds = (g.adminIds || []).filter(x => x !== uid);
    if (a.mode === 'add') g.adminIds.push(uid);
  } else if (action === 'group_claim') {
    if (!root) throw new GroupAccessDenied();
    g.ownerId = await target();
    g.adminIds = (g.adminIds || []).filter(uid => uid !== g.ownerId);
    delete g.transfer;
  } else if (action === 'group_transfer') {
    ownerOnly(g, actor, root);
    if (!g.ownerId) c.fail('请先指定班级所有者');
    const uid = await target();
    if (uid === g.ownerId) c.fail('请选择其他用户接收班级');
    g.transfer = { id: randomUUID(), from: g.ownerId, to: uid, at: Date.now() };
  } else if (action === 'group_transfer_cancel') {
    ownerOnly(g, actor, root); delete g.transfer;
  } else if (action === 'group_transfer_accept' || action === 'group_transfer_reject') {
    if (!g.transfer || g.transfer.to !== actor || g.transfer.id !== a.transferId
      || g.transfer.from !== g.ownerId) throw new GroupAccessDenied();
    await validateUser(actor);
    if (action === 'group_transfer_accept') {
      g.adminIds = [...new Set([...(g.adminIds || []), g.ownerId])].filter(uid => uid !== actor);
      g.ownerId = actor;
    }
    delete g.transfer;
  } else if (action !== 'group_members') c.fail('未知班级操作');

  for (const group of touched.length ? touched : [g]) group.version = (group.version || 0) + 1;
  (s.audit ||= []).push({ action, actor, groupIds: touched.length ? touched.map(x => x.id) : [g.id],
    ...(a.uid ? { uid: Number(a.uid) } : {}), at: Date.now() });
  return { id: g?.id };
}
module.exports = { GroupAccessDenied, owns, manages, sees, view, changeGroup };
