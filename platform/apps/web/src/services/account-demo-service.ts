export function validateDemoPassword(
  currentPassword: string,
  nextPassword: string,
  confirmation: string,
): string | null {
  if (currentPassword !== 'demo-password') return '演示账户当前密码不正确';
  if (nextPassword.length < 8) return '新密码至少需要 8 位';
  if (nextPassword !== confirmation) return '两次输入的新密码不一致';
  return null;
}
