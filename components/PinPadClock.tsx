import React, { useState } from 'react';
import { X, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../utils/api';

interface PinPadClockProps {
    onClose: () => void;
}

export const PinPadClock: React.FC<PinPadClockProps> = ({ onClose }) => {
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    const handleKeyPress = (num: string) => {
        if (pin.length < 4) setPin(prev => prev + num);
    };

    const handleDelete = () => setPin(prev => prev.slice(0, -1));
    const handleClear = () => setPin('');

    const handleAction = async (action: 'clock-in' | 'clock-out') => {
        if (pin.length !== 4) {
            setErrorMsg('El PIN debe tener 4 dígitos');
            return;
        }

        setLoading(true);
        setErrorMsg('');
        setSuccessMsg('');

        try {
            const { data } = await api.post(\`/hr/\${action}\`, { pin });
      setSuccessMsg(data.message);
      setPin('');
      
      // Auto close after success
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 font-sans backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 w-full max-w-sm shadow-2xl relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-indigo-500 rounded-full blur-3xl opacity-20 pointer-events-none"></div>

        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 p-2 rounded-full transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="mx-auto w-16 h-16 bg-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center mb-4">
            <Clock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">Terminal de Asistencia</h2>
          <p className="text-slate-400 text-sm">Ingresa tu PIN de 4 dígitos</p>
        </div>

        {/* Display PIN */}
        <div className="flex justify-center gap-3 mb-8">
          {[...Array(4)].map((_, i) => (
            <div 
              key={i} 
              className={\`w-14 h-16 rounded-xl flex items-center justify-center text-3xl font-bold
                \${pin.length > i 
                  ? 'bg-indigo-600 text-white border border-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.5)]' 
                  : 'bg-slate-800 text-slate-500 border border-slate-700'
                } transition-all duration-200\`}
            >
              {pin.length > i ? '•' : ''}
            </div>
          ))}
        </div>

        {/* Status Messages */}
        {errorMsg && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 text-sm animate-pulse">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>{errorMsg}</p>
          </div>
        )}
        {successMsg && (
          <div className="mb-6 p-3 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3 text-green-400 text-sm">
            <CheckCircle className="w-5 h-5 shrink-0" />
            <p>{successMsg}</p>
          </div>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              disabled={loading}
              className="h-16 rounded-2xl bg-slate-800 border border-slate-700 text-2xl font-semibold text-white hover:bg-slate-700 hover:border-slate-600 active:scale-95 transition-all shadow-sm"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleClear}
            disabled={loading || pin.length === 0}
            className="h-16 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-white active:scale-95 transition-all"
          >
            CLEAR
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            disabled={loading}
            className="h-16 rounded-2xl bg-slate-800 border border-slate-700 text-2xl font-semibold text-white hover:bg-slate-700 hover:border-slate-600 active:scale-95 transition-all shadow-sm"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            disabled={loading || pin.length === 0}
            className="h-16 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-white active:scale-95 transition-all flex items-center justify-center gap-1"
          >
            <X className="w-4 h-4" /> DEL
          </button>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4 mt-2">
          <button
            onClick={() => handleAction('clock-in')}
            disabled={loading || pin.length !== 4}
            className="py-4 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl flex flex-col items-center justify-center gap-1 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
          >
            <span className="text-sm opacity-80 uppercase tracking-wider">Entrada</span>
            <span className="text-xl">Clock IN</span>
          </button>
          
          <button
            onClick={() => handleAction('clock-out')}
            disabled={loading || pin.length !== 4}
            className="py-4 px-4 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl flex flex-col items-center justify-center gap-1 transition-all shadow-lg shadow-rose-500/20 active:scale-95"
          >
            <span className="text-sm opacity-80 uppercase tracking-wider">Salida</span>
            <span className="text-xl">Clock OUT</span>
          </button>
        </div>

      </div>
    </div>
  );
};
