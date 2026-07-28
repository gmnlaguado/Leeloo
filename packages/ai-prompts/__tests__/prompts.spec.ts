import {
  buildSystemPrompt,
  LEELOO_PERSONALITIES,
  ALL_LEELOO_PERSONALITIES,
  LEELOO_SYSTEM_PROMPT_VERSION,
} from '../src';

describe('@leeloo/ai-prompts', () => {
  const baseContext = {
    todayTasks: ['llevar zapatillas a Antonella', 'meeting 10am'],
    upcomingEvents: ['partido 4pm'],
    pendingApprovals: 2,
    timeOfDay: 'morning' as const,
  };

  it('exposes the seven personalities', () => {
    expect(ALL_LEELOO_PERSONALITIES).toHaveLength(7);
    for (const p of ALL_LEELOO_PERSONALITIES) {
      expect(LEELOO_PERSONALITIES[p]).toBeDefined();
    }
  });

  it('exposes a stable prompt version', () => {
    expect(LEELOO_SYSTEM_PROMPT_VERSION).toBe('2.0.0');
  });

  it('buildSystemPrompt embeds the user name', () => {
    const prompt = buildSystemPrompt('default', 'Susana', baseContext);
    expect(prompt).toContain('Susana');
    expect(prompt).toContain('SUSANA');
  });

  it('buildSystemPrompt embeds the context lines', () => {
    const prompt = buildSystemPrompt('coach', 'Susana', baseContext);
    expect(prompt).toContain('llevar zapatillas a Antonella');
    expect(prompt).toContain('partido 4pm');
    expect(prompt).toContain('Hora del día: morning');
    expect(prompt).toContain('Solicitudes de hijos pendientes de aprobación: 2');
  });

  it('buildSystemPrompt falls back to default personality on unknown key', () => {
    const prompt = buildSystemPrompt('unknown' as any, 'Ana', {
      todayTasks: [],
      upcomingEvents: [],
      pendingApprovals: 0,
      timeOfDay: 'night',
    });
    expect(prompt).toContain('asistente perfecta');
    expect(prompt).toContain('ninguna registrada aún');
    expect(prompt).toContain('calendario limpio');
  });

  it('buildSystemPrompt embeds Christian-mode language when selected', () => {
    const prompt = buildSystemPrompt('christian', 'María', baseContext);
    expect(prompt).toMatch(/María/);
    expect(prompt).toMatch(/versículo|oración|Dios/i);
  });

  it('buildSystemPrompt enforces the absolute rules block', () => {
    const prompt = buildSystemPrompt('default', 'Susana', baseContext);
    expect(prompt).toContain('REGLAS ABSOLUTAS');
    expect(prompt).toContain('Máximo 2-3 oraciones');
  });
});
