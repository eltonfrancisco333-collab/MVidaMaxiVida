export async function fetchDashboardTemplate() {
  const response = await fetch('/dashboard.html');
  if (!response.ok) throw new Error('Não foi possível carregar o dashboard original.');
  return response.text();
}
