import React, { useState } from 'react';
import Layout from './components/Layout';
import POS from './components/POS';
import Dashboard from './components/Dashboard';
import BlueprintViewer from './components/BlueprintViewer';
import { ViewMode } from './types';

function App() {
  const [currentView, setCurrentView] = useState<ViewMode>('DASHBOARD');

  const renderView = () => {
    switch (currentView) {
      case 'POS':
        return <POS />;
      case 'DASHBOARD':
        return <Dashboard />;
      case 'BLUEPRINT':
        return <BlueprintViewer />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout currentView={currentView} onNavigate={setCurrentView}>
      {renderView()}
    </Layout>
  );
}

export default App;