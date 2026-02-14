export const projects = {
  dev: 'serverless-felix-dev',
  prd: 'serverless-felix-prd',
};

export const resolveProjectId = (environment, usage) => {
  if (!environment || !(environment in projects)) {
    console.error(usage);
    process.exit(1);
  }
  return projects[environment];
};
