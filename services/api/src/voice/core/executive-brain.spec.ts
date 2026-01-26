import { ExecutiveBrain } from './executive-brain';

describe('ExecutiveBrain', () => {
  it('selects VOICE_TASK when source=voice and pending_intent exists', () => {
    const brain = new ExecutiveBrain();
    const ctx = brain.assembleContext({
      source: 'voice',
      language: 'en',
      pending_intent: { intent: 'send_email' },
      last_question: 'What should it say?',
      user_name: 'Lisa',
      input_normalized: 'hello',
      role_policy: 'DEFAULT',
    });
    expect(brain.selectMode(ctx)).toBe('VOICE_TASK');
    const policy = brain.buildResponsePolicy(ctx);
    expect(policy.max_sentences).toBe(2);
  });

  it('selects VOICE_CHAT when source=voice and no pending intent', () => {
    const brain = new ExecutiveBrain();
    const ctx = brain.assembleContext({
      source: 'voice',
      language: 'en',
      pending_intent: null,
      last_question: null,
      user_name: null,
      input_normalized: 'how are you',
      role_policy: 'DEFAULT',
    });
    expect(brain.selectMode(ctx)).toBe('VOICE_CHAT');
  });

  it('postProcess enforces max sentences and single question', () => {
    const brain = new ExecutiveBrain();
    const ctx = brain.assembleContext({
      source: 'voice',
      language: 'en',
      pending_intent: null,
      last_question: null,
      user_name: null,
      input_normalized: 'test',
      role_policy: 'DEFAULT',
    });
    const policy = brain.buildResponsePolicy(ctx);
    const raw = 'First sentence. Second sentence? Third sentence. Fourth sentence?';
    const out = brain.postProcess(raw, policy);
    expect((out.match(/\?/g) || []).length).toBeLessThanOrEqual(1);
    const sentences = out.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(sentences.length).toBeLessThanOrEqual(2);
  });
});
