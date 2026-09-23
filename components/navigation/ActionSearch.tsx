import React, { useId, useState } from 'react';
import { Search } from 'lucide-react';
import { searchAllowedActions } from '../../utils/actionSearch';

type SearchEntry = { path: string; label: string; shortLabel: string; group: string };

interface Props {
    entries: readonly SearchEntry[];
    onSelect: (event: React.MouseEvent<HTMLButtonElement>, path: string) => void;
}

export default function ActionSearch({ entries, onSelect }: Props) {
    const inputId = useId();
    const [query, setQuery] = useState('');
    const matches = searchAllowedActions(entries, query);

    const choose = (event: React.MouseEvent<HTMLButtonElement>, path: string) => {
        onSelect(event, path);
        setQuery('');
    };

    return <div className="relative min-w-0 flex-1">
        <label className="sr-only" htmlFor={inputId}>Buscar una función</label>
        <div className="nx-shell-control nx-shell-border flex min-h-tap items-center gap-2 rounded-xl border px-3">
            <Search size={16} aria-hidden="true" />
            <input id={inputId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="¿Qué querés hacer?" autoComplete="off" className="nx-shell-text w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-slate-400" />
        </div>
        {query.trim() && <div className="nx-dark-chrome nx-shell-border absolute inset-x-0 top-full z-modal mt-1 max-h-72 overflow-y-auto rounded-xl border p-1 shadow-xl" role="region" aria-label="Funciones encontradas">
            {matches.length === 0 ? <p className="nx-shell-muted px-3 py-3 text-sm">No encontramos una función con ese nombre.</p> : matches.map((entry) => <button key={entry.path} type="button" onClick={(event) => choose(event, entry.path)} className="nx-shell-control nx-shell-text nx-fluid-press flex min-h-tap w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10">{entry.label}</button>)}
        </div>}
    </div>;
}
