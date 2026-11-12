// Imita "claude -p --output-format stream-json": lee el prompt y emite eventos.
// Para las tareas de correo (prompt con <items>...</items>) devuelve un JSON segun
// FALSO_MODO: valido (defecto) | invalido | sinjson | colgar | prosa | extra.
// Para --probar-correo (prompt de diagnostico) segun FALSO_MODO: sin_outlook | otro_prefijo.
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (t) => (prompt += t));
process.stdin.on('end', () => {
  const emitir = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const modo = process.env.FALSO_MODO || '';
  if (prompt.includes('FALLAR')) {
    emitir({ type: 'result', is_error: true, result: 'límite de uso alcanzado' });
    return;
  }

  if (prompt.includes('diagnóstico del conector de correo')) {
    const prefijo = modo === 'otro_prefijo' ? 'Outlook_Corp' : 'claude_ai_Microsoft_365';
    const tools = ['Bash', 'Read', 'mcp__myquote__consultar_producto'];
    if (modo !== 'sin_outlook') tools.push(`mcp__${prefijo}__outlook_email_search`, `mcp__${prefijo}__outlook_send_mail`);
    emitir({ type: 'system', subtype: 'init', tools, mcp_servers: [{ name: 'myquote', status: 'connected' }] });
    emitir({ type: 'assistant', message: { id: 'p1', content: [{ type: 'text', text: 'Asunto A - 2026-11-10\nAsunto B - 2026-11-09\nAsunto C - 2026-11-08' }] } });
    emitir({ type: 'result', is_error: false, result: 'Asunto A - 2026-11-10\nAsunto B - 2026-11-09\nAsunto C - 2026-11-08' });
    return;
  }

  emitir({ type: 'system', subtype: 'init' });

  const m = /<items>\n([\s\S]*?)\n<\/items>/.exec(prompt);
  if (m) {
    if (modo === 'colgar') return setTimeout(() => {}, 60000); // nunca termina: lo mata el timeout
    const tipo = /Tipo de tarea: (\w+)/.exec(prompt)[1];
    const items = JSON.parse(m[1]);
    emitir({ type: 'assistant', message: { id: 'c1', content: [{ type: 'tool_use', id: 'u1', name: 'mcp__claude_ai_Microsoft_365__outlook_email_search', input: { query: 'ASUNTO SECRETO' } }] } });
    emitir({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'cuerpo secreto del correo' }] } });
    const resultado = items.map((i) => {
      if (tipo === 'buscar_envios') {
        return i.numero % 2
          ? { cotizacion_id: i.cotizacion_id, encontrado: true, message_id: `m-${i.cotizacion_id}`, conversation_id: `c-${i.cotizacion_id}`, enviado_en: '2026-11-03T14:00:00-03:00', para: ['cliente@acme.cl'], asunto: 'Cotización', extra: 'x' }
          : { cotizacion_id: i.cotizacion_id, encontrado: false };
      }
      if (tipo === 'revisar_hilos') return { oportunidad_id: i.oportunidad_id, respuesta_recibida: true, respuesta_en: '2026-11-05T10:00:00-03:00', remitente: 'cliente@acme.cl', resumen: 'x'.repeat(500), borrador_existe: false };
      return { oportunidad_id: i.oportunidad_id, creado: true, borrador_id: `b-${i.oportunidad_id}`, asunto: 'RE: Cotización' };
    });
    let texto;
    if (modo === 'invalido') texto = '```json\n{"items":[{"cotizacion_id":1,"encontrado":"quizas"}]}\n```';
    else if (modo === 'sinjson') texto = 'Listo, encontré todo.';
    else if (modo === 'prosa') texto = `Resumen: hecho.\n\n{"items": ${JSON.stringify(resultado)}}\n`; // JSON sin cerco
    else if (modo === 'extra') texto = '```json\n' + JSON.stringify({ items: [...resultado, { oportunidad_id: 999, creado: true, borrador_id: 'z' }, { cotizacion_id: 999, encontrado: false }] }) + '\n```';
    else texto = 'Hecho.\n\n```json\n' + JSON.stringify({ items: resultado }) + '\n```';
    emitir({ type: 'assistant', message: { id: 'c2', content: [{ type: 'text', text: texto }] } });
    emitir({ type: 'result', is_error: false, result: texto });
    return;
  }

  emitir({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'mcp__myquote__consultar_producto', input: { sku: 'P1475-LE' } }] } });
  emitir({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'datos de cliente que no deben medirse' }] } });
  emitir({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'x' } }] } });
  emitir({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'x' }] } });
  emitir({ type: 'assistant', message: { id: 'm3', content: [{ type: 'text', text: 'Andrea.\n\n| Marca | Cant. |' }] } });
  emitir({ type: 'result', is_error: false, result: `Respuesta final (${prompt.length} chars de prompt)` });
});
