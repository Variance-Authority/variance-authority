// The deployment `variance.yml`'s `tribunal-service` job puts this commit's
// review service at, built from the workspace rather than from a release, so a
// pull request that changes the service is judged by the service it ships.
export { default } from '@variance-authority/tribunal/worker-entry';
