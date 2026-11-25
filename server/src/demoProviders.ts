// Scripted colleagues used when no API keys are set (and by `npm run debate -- --fake`): the whole flow works, the words are canned.
import { fakeProvider } from './providers.js';
import type { Provider } from './providers.js';

type Call = { messages: { content: string }[] };
const titleOf = (c: Call) => /## NEW NOTE \[[^\]]*\] \([^)]*\)\n([^\n]*)/.exec(c.messages[0].content)?.[1]?.trim() || 'this note';
const founderSaid = (c: Call) => /The founder said: ([^\n]*)/.exec(c.messages.map((m) => m.content).join('\n'))?.[1];

export function demoProviders(delayMs = Number(process.env.DEMO_DELAY_MS ?? 60)): { claude: Provider; gpt: Provider } {
  const summary = (c: Call) => JSON.stringify({
    verdict: 'needs_work', summary: `"${titleOf(c)}" का angle साफ़ है, लेकिन अभी किसी ने साबित नहीं किया कि customer इसके लिए पैसे देंगे।`,
    key_points: ['Pattern असली है: कम इस्तेमाल होने वाली चीज़ को एक app के पीछे लाना।', 'Supply आसानी से मिल जाएगी; असली सवाल पैसे देने वाले का है।'],
    risks: ['साफ़ नहीं कि पहले पैसा कौन देगा।', 'मौजूदा apps या आदतें काफ़ी हो सकती हैं।'],
    next_steps: ['इस हफ़्ते दस संभावित customers से बात करें।', 'लिखें कि वे आज कितना खर्च करते हैं।'],
    suggested_links: [], suggested_notes: [{ type: 'question', title: 'पहले पैसा कौन देगा?', body: 'Supply वाला या demand वाला?' }],
  });
  return {
    claude: fakeProvider('claude', [
      (c) => `(demo) "${titleOf(c)}" मुझे कम इस्तेमाल होने वाली चीज़ का marketplace लगता है। यह pattern जाना-पहचाना है और supply पहले से मौजूद है।${founderSaid(c) ? ` आपकी बात "${founderSaid(c)}" को मैं सबसे पहले परखूँगा।` : ''}`,
      (c) => `(demo) बात सही है। यह founder के जुड़े हुए notes से मेल खाता है: चीज़ वही, खरीदार अलग।${founderSaid(c) ? ` Founder का विचार "${founderSaid(c)}" यहाँ फ़िट बैठता है।` : ''}`,
      summary,
    ], { delayMs }),
    gpt: fakeProvider('gpt', [
      () => '(demo) पहले पैसा कौन देगा, और वे आज का तरीक़ा क्यों छोड़ेंगे? मैं इसी कमी को परखूँगा।',
      () => '(demo) Pattern पर सहमत हूँ। कुछ भी बनाने से पहले दस असली customers से इसे validate करें।',
    ], { delayMs }),
  };
}
