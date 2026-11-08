import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

export const manifest = setupManifest({
  id: 'fulcrum-pruned',
  title: 'Fulcrum Pruned',
  license: 'MIT',
  packageRepo: 'https://github.com/paulscode/fulcrum-pruned-startos',
  upstreamRepo: 'https://github.com/cculianu/Fulcrum',
  marketingUrl: 'https://github.com/cculianu/Fulcrum',
  donationUrl: 'https://github.com/cculianu/Fulcrum',
  description: { short, long },
  // StartOS 0.4.0.2, not the SDK's default, so the registry hides releases from older servers.
  // Every package in this stack targets 0.4.0.2 from 2026-10-11 on; release.sh refuses less.
  osVersion: '0.4.0.2',
  volumes: ['main'],
  images: {
    main: {
      source: {
        dockerBuild: {
          // The repo-root Dockerfile, not the fork's contrib/docker/Dockerfile: the build has to see
          // patches/ as well as the fulcrum submodule.
          dockerfile: 'Dockerfile',
          workdir: '.',
          // The submodule's .git is a file pointing outside the build context, so the build cannot
          // work the commit out for itself and the binary would report an empty one. See Makefile.
          buildArgs: { FULCRUM_GIT_COMMIT: { env: 'FULCRUM_GIT_COMMIT' } },
        },
      },
      arch: ['x86_64', 'aarch64'],
      // Never offer this image to an architecture it was not built for, under emulation.
      emulateMissing: false,
    },
  },
  // Dependencies are declared in dependencies.ts, which the SDK writes into the manifest.
})
