import React, { useState } from 'react';
import { BLUEPRINTS } from '../constants';
import { Check, Copy, Terminal } from 'lucide-react';

const BlueprintViewer: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(BLUEPRINTS[activeTab].content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="nx-light-context nx-workspace flex h-full flex-col overflow-hidden bg-slate-50 p-4 text-slate-950 sm:p-6">
      <div className="mb-6">
        <h2 className="nx-module-header flex items-center gap-2 text-2xl font-bold text-slate-950">
          <Terminal className="text-brand" size={24} />
          CTO_MODE: ARQUITECTURA
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Plan maestro de infraestructura y datos para Jose 2.0
        </p>
      </div>

      <div className="nx-canvas-card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Tabs */}
        <div className="nx-catalog-tabs flex overflow-x-auto border-b border-slate-200 bg-white">
          {BLUEPRINTS.map((bp, index) => (
            <button
              key={bp.name}
              onClick={() => setActiveTab(index)}
              className={`nx-fluid-press min-h-tap shrink-0 border-r border-slate-200 px-4 py-3 text-sm font-semibold transition-colors ${
                activeTab === index
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
              }`}
            >
              {bp.name}
            </button>
          ))}
        </div>

        {/* Content Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-xs text-slate-600">
            {BLUEPRINTS[activeTab].description}
          </span>
          <button
            onClick={handleCopy}
            className="nx-fluid-press min-h-tap flex shrink-0 items-center gap-2 rounded-control bg-brand px-3 py-2 text-xs font-semibold text-brand-on transition-colors hover:bg-brand-hover"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'COPIADO' : 'COPIAR CÓDIGO'}
          </button>
        </div>

        {/* Code View */}
        <div className="nx-code-surface custom-scrollbar flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed">
          <pre className="text-slate-100">
            <code>{BLUEPRINTS[activeTab].content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};

export default BlueprintViewer;
