export interface SkillNode {
  id: string;
  labelKey: string; // i18n key under skillTree.*
  children?: SkillNode[];
}

export const skillTreeRoot: SkillNode = {
  id: 'root',
  labelKey: 'skillTree.root',
  children: [
    {
      id: 'development',
      labelKey: 'skillTree.development',
      children: [
        {
          id: 'languages',
          labelKey: 'skillTree.languages',
          children: [
            { id: 'typescript', labelKey: 'skillTree.typescript' },
            { id: 'python', labelKey: 'skillTree.python' },
            { id: 'java', labelKey: 'skillTree.java' },
            { id: 'go', labelKey: 'skillTree.go' },
          ],
        },
        {
          id: 'frontend',
          labelKey: 'skillTree.frontend',
          children: [
            { id: 'react', labelKey: 'skillTree.react' },
            { id: 'accessibility', labelKey: 'skillTree.accessibility' },
            { id: 'designSystems', labelKey: 'skillTree.designSystems' },
          ],
        },
        {
          id: 'devops',
          labelKey: 'skillTree.devops',
          children: [
            { id: 'docker', labelKey: 'skillTree.docker' },
            { id: 'kubernetes', labelKey: 'skillTree.kubernetes' },
            { id: 'cicd', labelKey: 'skillTree.cicd' },
            { id: 'cloud', labelKey: 'skillTree.cloud' },
          ],
        },
        {
          id: 'architecture',
          labelKey: 'skillTree.architecture',
          children: [
            { id: 'microservices', labelKey: 'skillTree.microservices' },
            { id: 'apis', labelKey: 'skillTree.apis' },
            { id: 'security', labelKey: 'skillTree.security' },
          ],
        },
      ],
    },
    {
      id: 'research',
      labelKey: 'skillTree.research',
      children: [
        {
          id: 'userResearch',
          labelKey: 'skillTree.userResearch',
          children: [
            { id: 'interviews', labelKey: 'skillTree.interviews' },
            { id: 'usability', labelKey: 'skillTree.usability' },
            { id: 'surveys', labelKey: 'skillTree.surveys' },
          ],
        },
        {
          id: 'dataAnalysis',
          labelKey: 'skillTree.dataAnalysis',
          children: [
            { id: 'statistics', labelKey: 'skillTree.statistics' },
            { id: 'dataviz', labelKey: 'skillTree.dataviz' },
            { id: 'ml', labelKey: 'skillTree.ml' },
          ],
        },
        {
          id: 'benchmarking',
          labelKey: 'skillTree.benchmarking',
          children: [
            { id: 'competitive', labelKey: 'skillTree.competitive' },
            { id: 'bestPractices', labelKey: 'skillTree.bestPractices' },
          ],
        },
      ],
    },
    {
      id: 'communication',
      labelKey: 'skillTree.communication',
      children: [
        {
          id: 'writing',
          labelKey: 'skillTree.writing',
          children: [
            { id: 'documentation', labelKey: 'skillTree.documentation' },
            { id: 'techWriting', labelKey: 'skillTree.techWriting' },
            { id: 'reporting', labelKey: 'skillTree.reporting' },
          ],
        },
        {
          id: 'presenting',
          labelKey: 'skillTree.presenting',
          children: [
            { id: 'publicSpeaking', labelKey: 'skillTree.publicSpeaking' },
            { id: 'storytelling', labelKey: 'skillTree.storytelling' },
            { id: 'facilitation', labelKey: 'skillTree.facilitation' },
          ],
        },
        {
          id: 'collaboration',
          labelKey: 'skillTree.collaboration',
          children: [
            { id: 'feedbackCulture', labelKey: 'skillTree.feedbackCulture' },
            { id: 'conflictResolution', labelKey: 'skillTree.conflictResolution' },
          ],
        },
      ],
    },
    {
      id: 'organisation',
      labelKey: 'skillTree.organisation',
      children: [
        {
          id: 'projectMgmt',
          labelKey: 'skillTree.projectMgmt',
          children: [
            { id: 'agile', labelKey: 'skillTree.agile' },
            { id: 'planning', labelKey: 'skillTree.planning' },
            { id: 'riskMgmt', labelKey: 'skillTree.riskMgmt' },
          ],
        },
        {
          id: 'leadership',
          labelKey: 'skillTree.leadership',
          children: [
            { id: 'coaching', labelKey: 'skillTree.coaching' },
            { id: 'delegation', labelKey: 'skillTree.delegation' },
            { id: 'decisionMaking', labelKey: 'skillTree.decisionMaking' },
          ],
        },
        {
          id: 'productivity',
          labelKey: 'skillTree.productivity',
          children: [
            { id: 'prioritisation', labelKey: 'skillTree.prioritisation' },
            { id: 'timeManagement', labelKey: 'skillTree.timeManagement' },
          ],
        },
      ],
    },
  ],
};
