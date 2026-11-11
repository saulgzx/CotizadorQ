// Imita "claude -p --output-format stream-json": lee el prompt y emite eventos.
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (t) => (prompt += t));
process.stdin.on('end', () => {
  const emitir = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  if (prompt.includes('FALLAR')) {
    emitir({ type: 'result', is_error: true, result: 'límite de uso alcanzado' });
    return;
  }
  emitir({ type: 'system', subtype: 'init' });
  emitir({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'mcp__myquote__consultar_producto', input: { sku: 'P1475-LE' } }] } });
  emitir({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'datos de cliente que no deben medirse' }] } });
  emitir({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'x' } }] } });
  emitir({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'x' }] } });
  emitir({ type: 'assistant', message: { id: 'm3', content: [{ type: 'text', text: 'Andrea.\n\n| Marca | Cant. |' }] } });
  emitir({ type: 'result', is_error: false, result: `Respuesta final (${prompt.length} chars de prompt)` });
});
