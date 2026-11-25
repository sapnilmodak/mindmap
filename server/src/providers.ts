import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { cfg } from './config.js';

export interface ChatMsg { role: 'user' | 'assistant'; content: string }
export interface Usage { inputTokens: number; outputTokens: number }

// stream() yields text pieces and RETURNS the token usage when it finishes (read it with collect()).
export interface Provider {
  name: 'claude' | 'gpt';
  stream(system: string, messages: ChatMsg[], maxTokens: number, signal?: AbortSignal): AsyncGenerator<string, Usage, void>;
}

export async function collect(gen: AsyncGenerator<string, Usage, void>, onDelta: (t: string) => void = () => undefined): Promise<{ text: string; usage: Usage }> {
  let text = '';
  for (;;) {
    const r = await gen.next();
    if (r.done) return { text, usage: r.value };
    text += r.value; onDelta(r.value);
  }
}

// Sonnet 5.5 thinks by default and that thinking counts against max_tokens, which would starve a short spoken turn.
// `between_tools` is its "thinking off" setting (there are no tools here). Other models reject it, so only send it to this one.
const noThinking = (model: string) => (model === 'claude-sonnet-5-5' ? { thinking: { type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam } : {});

export function claudeProvider(): Provider {
  const client = new Anthropic({ apiKey: cfg.anthropicKey });
  return {
    name: 'claude',
    async *stream(system, messages, maxTokens, signal) {
      // The system block (persona + founder profile) repeats on every call of a debate, so it is cached.
      const s = client.messages.stream(
        { model: cfg.claudeModel, max_tokens: maxTokens, ...noThinking(cfg.claudeModel), system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages },
        { signal },
      );
      for await (const ev of s) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text;
      }
      const u = (await s.finalMessage()).usage;
      return { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
    },
  };
}

export function gptProvider(): Provider {
  const client = new OpenAI({ apiKey: cfg.openaiKey });
  return {
    name: 'gpt',
    async *stream(system, messages, maxTokens, signal) {
      const s = await client.chat.completions.create(
        {
          model: cfg.openaiModel, max_completion_tokens: maxTokens, stream: true, stream_options: { include_usage: true },
          messages: [{ role: 'system', content: system }, ...messages],
        },
        { signal },
      );
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      for await (const chunk of s) {
        const t = chunk.choices[0]?.delta?.content;
        if (t) yield t;
        if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
      }
      return usage;
    },
  };
}

// A scripted colleague for tests and for trying the flow without API keys. Each entry is the reply to one call:
// a string, an Error to throw, or a function of the call. Every call is recorded in `calls`.
export interface FakeCall { system: string; messages: ChatMsg[]; maxTokens: number }
export type FakeReply = string | Error | ((c: FakeCall) => string);
export function fakeProvider(name: 'claude' | 'gpt', replies: FakeReply[], opts: { delayMs?: number } = {}): Provider & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  return {
    name, calls,
    async *stream(system, messages, maxTokens, signal) {
      const call = { system, messages, maxTokens };
      calls.push(call);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r instanceof Error) throw r;
      const text = typeof r === 'function' ? r(call) : r;
      for (let i = 0; i < text.length; i += 14) {
        if (signal?.aborted) throw new Error('aborted');
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        yield text.slice(i, i + 14);
      }
      return { inputTokens: Math.ceil((system.length + messages.reduce((n, m) => n + m.content.length, 0)) / 4), outputTokens: Math.ceil(text.length / 4) };
    },
  };
}
