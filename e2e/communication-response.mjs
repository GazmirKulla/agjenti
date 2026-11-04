// Synthetic provider adapter for the current response contract. This never
// contacts a model and must not be imported into application code.
export function communicationResponse(request, prose) {
  const format = request.text?.format?.name;
  if (format === 'process_question') {
    const { interaction } = JSON.parse(request.input);
    const guidance = interaction.guidance?.trim();
    const text = guidance && guidance.length <= 230 && !/[\r\n<>\[\]]/.test(guidance)
      ? `${guidance.replace(/[?.!]+$/, '')}?` : `What is your ${interaction.field}?`;
    return JSON.stringify({ field: interaction.field, text });
  }
  if (format !== 'customer_communication') return prose;
  if (prose?.includes('[[ask_customer:')) return JSON.stringify({
    answer: 'Përgjigje sintetike: mund ta përshtatim bisedën me kërkesën tënde.',
    question: { field: 'name', text: 'Si të quajnë?', purpose: 'understand_need' },
  });
  return JSON.stringify({ answer: prose, question: null });
}
