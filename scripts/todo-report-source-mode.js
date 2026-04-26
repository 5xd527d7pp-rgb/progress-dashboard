/**
 * メール／打合せ／会議ルーティンを含めるか。
 * TODO_REPORT_PHONE_ONLY が 0 / false / no / off のときだけマージする。
 * 未設定時はスプレッドシート（電話ログ）のみ。
 */
export function isPhoneOnlyTodoReport() {
  const v = String(process.env.TODO_REPORT_PHONE_ONLY ?? '').toLowerCase().trim();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return true;
}
