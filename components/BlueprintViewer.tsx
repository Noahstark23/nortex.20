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
    <div className="flex flex-col h-full bg-nortex-900 text-slate-300 p-6 overflow-hidden">
      <div className="mb-6">
        <h2 className="text-2xl font-mono font-bold text-nortex-accent flex items-center gap-2">
          <Terminal size={24} />
          CTO_MODE: ARQUITECTURA
        </h2>
        <p className="text-sm text-slate-400 mt-2">
          Plan maestro de infraestructura y datos para Jose 2.0
        </p>
      </div>

      <div className="flex-1 flex flex-col border border-nortex-800 rounded-lg overflow-hidden bg-nortex-800/50">
        {/* Tabs */}
        <div className="flex border-b border-nortex-800 bg-nortex-900">
          {BLUEPRINTS.map((bp, index) => (
            <button
              key={bp.name}
              onClick={() => setActiveTab(index)}
              className={`px-4 py-3 text-sm font-mono border-r border-nortex-800 transition-colors ${
                activeTab === index
                  ? 'bg-nortex-800 text-nortex-accent'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-nortex-800/30'
              }`}
            >
              {bp.name}
            </button>
          ))}
        </div>

        {/* Content Header */}
        <div className="px-4 py-3 bg-nortex-800/80 border-b border-nortex-700 flex justify-between items-center">
          <span className="text-xs font-mono text-slate-400">
            {BLUEPRINTS[activeTab].description}
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-white transition-all"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'COPIADO' : 'COPIAR CÓDIGO'}
          </button>
        </div>

        {/* Code View */}
        <div className="flex-1 overflow-auto bg-[#0d1117] p-4 font-mono text-sm leading-relaxed custom-scrollbar">
          <pre className="text-slate-300">
            <code>{BLUEPRINTS[activeTab].content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};

export default BlueprintViewer;