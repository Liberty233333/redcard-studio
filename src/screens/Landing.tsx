import { BookOpen, Copy, Settings, Trash2 } from 'lucide-react';

import type { RedCardProject } from '../types';
import { projectDisplayTitle } from '../workbench/projectTitle';

import '../styles/landing.css';

type LandingProps = {
  projects: RedCardProject[];
  onCreateProject: () => void;
  onOpenProject: (project: RedCardProject) => void;
  onDuplicateProject: (project: RedCardProject) => void;
  onDeleteProject: (id: string) => void;
  onOpenProvider: () => void;
  onOpenRules: () => void;
};

const STEPS = [
  ['01', '长文'],
  ['02', '文字卡片'],
  ['03', 'AI 封面'],
  ['04', '导出发布'],
];

export default function Landing({
  projects,
  onCreateProject,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
  onOpenProvider,
  onOpenRules,
}: LandingProps) {
  return (
    <>
      <LandingTopBar onOpenProvider={onOpenProvider} onOpenRules={onOpenRules} />
      <main className="landing">
        <WorkbenchHero onCreateProject={onCreateProject} />
        <ProjectsGrid
          projects={projects}
          onOpenProject={onOpenProject}
          onDuplicateProject={onDuplicateProject}
          onDeleteProject={onDeleteProject}
        />
      </main>
    </>
  );
}

function LandingTopBar({
  onOpenProvider,
  onOpenRules,
}: {
  onOpenProvider: () => void;
  onOpenRules: () => void;
}) {
  return (
    <header className="landing-topbar">
      <span className="landing-logo">RedCard</span>
      <div className="landing-actions">
        <button className="landing-rule-btn" onClick={onOpenRules}>
          <BookOpen className="landing-rule-icon" />
          知识档
        </button>
        <button className="landing-icon-btn" onClick={onOpenProvider} title="API 配置">
          <Settings className="landing-settings-icon" />
        </button>
      </div>
    </header>
  );
}

function WorkbenchHero({ onCreateProject }: { onCreateProject: () => void }) {
  return (
    <section className="workbench-hero">
      <div className="workbench-copy">
        <div className="masthead">
          <span className="vol-badge">VOL.001</span>
          <span className="masthead-kicker">Workbench · MMXXVI</span>
          <span className="masthead-rule" />
        </div>
        <h1 className="title">小红书图文<span className="title-block">工作台</span></h1>
        <p className="subtitle">
          From long-form thinking to editorial cards, AI cover, and launch-ready export.
          <span className="cn">把一篇长文整理成可发布的小红书图文项目，规则沉淀，素材留痕，输出可复用。</span>
        </p>
        <nav className="step-list" aria-label="工作流步骤">
          {STEPS.map(([num, text]) => (
            <a key={num} className="step-link" href="#projects">
              <span className="step-num">{num}</span>
              <span className="step-text">{text}</span>
            </a>
          ))}
        </nav>
      </div>
      <button className="create-note-btn" onClick={onCreateProject}>创建笔记</button>
    </section>
  );
}

function ProjectsGrid({
  projects,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
}: {
  projects: RedCardProject[];
  onOpenProject: (project: RedCardProject) => void;
  onDuplicateProject: (project: RedCardProject) => void;
  onDeleteProject: (id: string) => void;
}) {
  return (
    <section className="projects-section" id="projects">
      <div className="projects-head">
        <span className="section-label">PROJECTS</span>
        <h2 className="section-title">历史项目</h2>
        <span className="section-count">{projects.length} 个项目</span>
      </div>
      <div className="projects-grid">
        {projects.map((project, index) => (
          <article key={project.id} className="project-card">
            <button className="project-main" onClick={() => onOpenProject(project)}>
              <span className="project-num">{String(index + 1).padStart(2, '0')}</span>
              <span className="project-name">{projectDisplayTitle(project)}</span>
              <time className="project-date">{new Date(project.updatedAt).toLocaleString()}</time>
            </button>
            <div className="project-actions">
              <button className="icon-square" onClick={() => onDuplicateProject(project)} title="复制">
                <Copy className="project-action-icon" />
              </button>
              <button className="icon-square" onClick={() => onDeleteProject(project.id)} title="删除">
                <Trash2 className="project-action-icon" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
