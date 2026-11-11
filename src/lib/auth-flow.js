// Email confirmation is a successful request without an authenticated session.
export async function finishAuthentication(request, onConfirmation, navigate) {
  const result = await request;
  if (result.confirmationRequired) { onConfirmation(); return; }
  navigate(result.profile ? "/today" : "/profile");
}
