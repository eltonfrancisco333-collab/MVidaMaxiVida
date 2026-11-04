import React, { useEffect, useState } from 'react';
import { fetchDashboardTemplate } from '../services/api.js';
import { parseDashboardTemplate } from '../utils/parseDashboardTemplate.js';

export default function LegacyDashboard() {
  const [template, setTemplate] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetchDashboardTemplate()
      .then(parseDashboardTemplate)
      .then((loadedTemplate) => {
        if (active) setTemplate(loadedTemplate);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Não foi possível carregar o dashboard.');
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!template) return undefined;
    let active = true;
    const scripts = [];
    const loadScript = (source, content = '') => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      scripts.push(script);
      if (source) {
        script.src = source;
        script.async = false;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Não foi possível carregar a biblioteca ${source}.`));
      } else {
        script.textContent = content;
        resolve();
      }
      document.body.appendChild(script);
    });

    async function initializeDashboard() {
      try {
        for (const script of template.scripts) await loadScript(script.source, script.content);
      } catch (scriptError) {
        if (active) setError(scriptError.message || 'Não foi possível iniciar o dashboard.');
      }
    }
    initializeDashboard();

    return () => {
      active = false;
      scripts.forEach((script) => script.remove());
    };
  }, [template]);

  if (error) return <div className="app-error" role="alert">{error}</div>;
  if (!template) return <div className="app-loading" role="status">A carregar MVida MAXI VIDA...</div>;

  return <>
    <style>{template.styles}</style>
    <div className="legacy-dashboard-root" dangerouslySetInnerHTML={{ __html: template.markup }} />
  </>;
}
