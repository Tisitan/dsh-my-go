/** Local-spawn lifecycle adapter. No DSH imports or guessed argument counts. */
export async function startLocalChild(runtime, { label, request, signal, onResultError }) {
  if (typeof runtime?.startActivation === 'function') {
    // alpha.2: label/signal/delivery belong to the activation envelope. The
    // result is asynchronous and the manager owns accepted work; never wait
    // for completion here or go_work would block its own parent turn.
    const { label: _label, signal: _signal, ...task } = request;
    const activation = await runtime.startActivation({
      provider: 'spawn', label, request: task, signal, delivery: 'parent',
    });
    // The lifecycle end event remains the broker's sole accounting path.
    // Observe capture rejection separately without generating another end.
    void activation.result.catch((error) => onResultError?.(error, activation.childId));
    return activation;
  }
  if (typeof runtime?.startContinuable === 'function') {
    return runtime.startContinuable({ provider: 'spawn', label, request, signal });
  }
  throw new Error('MyGO requires local subagent startActivation or startContinuable support');
}
