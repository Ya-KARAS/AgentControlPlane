const TASK_ID = /^[0-9a-f-]{36}$/i;

export function parseRemoteTaskResponse(response, expectedStatus = 200) {
  let body;
  try {
    body = JSON.parse(response?.responseText ?? "");
  } catch {
    throw new Error("invalid_remote_task_response");
  }
  if (response?.status !== expectedStatus) {
    throw new Error(body?.error?.code ?? `http_${response?.status ?? 0}`);
  }
  const task = body?.task && typeof body.task === "object" ? body.task : body;
  if (
    !task
    || typeof task !== "object"
    || !TASK_ID.test(String(task.id ?? ""))
    || typeof task.status !== "string"
  ) {
    throw new Error("invalid_remote_task_response");
  }
  return body?.task ? body : { task };
}
