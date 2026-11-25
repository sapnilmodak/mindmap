// Shared digital-worker persona metadata — single source of truth for every
// visualization of the digital_workers pipeline node (the 3D mesh view and
// the live office view). Keys match services/strategy-service/main.py's
// DEFAULT_DIGITAL_WORKERS and tara-digital-worker/workers/*/*/worker.yaml.
import {
  DollarSign, ClipboardCheck, Globe, FileText, ShieldAlert, Search,
  Truck, Eye, PenTool, Send, Rocket, Server, Bug, Database, Crown, Swords, HelpCircle,
  type LucideIcon,
} from 'lucide-react';

export const CATEGORY_LABELS: Record<string, string> = {
  finance: 'Finance',
  legal: 'Legal',
  operations: 'Operations',
  marketing: 'Marketing',
  engineering: 'Engineering',
  executive: 'Executive',
  unknown: 'Other',
};

export const CATEGORY_COLORS: Record<string, string> = {
  finance: '#22c55e',
  legal: '#f97316',
  operations: '#3b82f6',
  marketing: '#a855f7',
  engineering: '#06b6d4',
  executive: '#ef4444',
  unknown: '#94a3b8',
};

export const WORKER_CATEGORY: Record<string, string> = {
  quant: 'finance', auditor: 'finance', economist: 'finance',
  paralegal: 'legal', warden: 'legal',
  scout: 'operations', dispatcher: 'operations', watchman: 'operations',
  scribe: 'marketing', sdr: 'marketing', growth_hacker: 'marketing',
  devops_sre: 'engineering', qa_tester: 'engineering', dba: 'engineering',
  chief_of_staff: 'executive', red_teamer: 'executive',
};

// A role-specific icon stands in for a literal human figure — it tells you
// what the worker *does* at a glance, which is what an animated human
// wouldn't add much over anyway.
export const WORKER_ICON: Record<string, LucideIcon> = {
  quant: DollarSign, auditor: ClipboardCheck, economist: Globe,
  paralegal: FileText, warden: ShieldAlert,
  scout: Search, dispatcher: Truck, watchman: Eye,
  scribe: PenTool, sdr: Send, growth_hacker: Rocket,
  devops_sre: Server, qa_tester: Bug, dba: Database,
  chief_of_staff: Crown, red_teamer: Swords,
};

export const WORKER_TITLE: Record<string, string> = {
  quant: 'Financial Modeling', auditor: 'Expense Audit', economist: 'Macro Pricing',
  paralegal: 'Contract Review', warden: 'Compliance Gate',
  scout: 'Procurement Research', dispatcher: 'Logistics', watchman: 'Escalations',
  scribe: 'Content Drafting', sdr: 'Outbound Sales', growth_hacker: 'Conversion Testing',
  devops_sre: 'Infrastructure', qa_tester: 'QA Automation', dba: 'Database Tuning',
  chief_of_staff: 'Orchestration', red_teamer: 'Adversarial Review',
};

export function workerCategory(worker: string): string {
  return WORKER_CATEGORY[worker] || 'unknown';
}

export function workerColor(worker: string): string {
  return CATEGORY_COLORS[workerCategory(worker)] || CATEGORY_COLORS.unknown;
}

export function workerIcon(worker: string): LucideIcon {
  return WORKER_ICON[worker] || HelpCircle;
}

export function workerTitle(worker: string): string {
  return WORKER_TITLE[worker] || CATEGORY_LABELS[workerCategory(worker)] || 'Digital Worker';
}
