import { execa } from 'execa'

const gitCliffBin = new URL('../node_modules/.bin/git-cliff', import.meta.url)
  .pathname

// Start from the Radashi's first commit after forking.
const changelogBaseSha = '2be4acf455ebec86e846854dbab57bd0bfbbceb7'

export async function generateChangelog(
  options: {
    /**
     * The base commit to start the changelog from. Defaults to the
     * first commit after forking Radash.
     */
    base?: string
    /**
     * Minimal formatting for single version changelog.
     */
    minimal?: boolean
    /**
     * The new version that will be used in the changelog header. Only
     * necessary if a tag commit hasn't been created.
     *
     * This has a "v" prefixed to it.
     */
    newVersion?: string
    /**
     * By default, the changelog is returned as a string. If an
     * `outFile` is provided, the changelog is written to the file.
     */
    outFile?: string
    /**
     * The GitHub token to use for fetching the commit history. If
     * undefined, the `$GITHUB_TOKEN` environment variable is used.
     */
    token?: string
  } = {},
) {
  const gitCliffArgs = [`${options.base ?? changelogBaseSha}..HEAD`]
  if (options.outFile) {
    gitCliffArgs.push('-o', options.outFile)
  }
  if (options.newVersion) {
    gitCliffArgs.push('--tag', `v${options.newVersion}`)
  }
  if (options.minimal) {
    gitCliffArgs.push('-s', 'all')
  }
  const { stdout } = await execa(gitCliffBin, gitCliffArgs, {
    env: {
      GITHUB_TOKEN: options.token ?? process.env.GITHUB_TOKEN,
      STRIP_TAG: String(options.minimal),
    },
  })
  return stdout
}

export async function inferNextVersion(options: { token?: string } = {}) {
  const latestTag = await getLatestReleaseTag()
  const gitCliffArgs = ['--bumped-version']
  for (const sha of await getCiScopedCommitShas(latestTag)) {
    gitCliffArgs.push('--skip-commit', sha)
  }

  const { stdout } = await execa(gitCliffBin, gitCliffArgs, {
    env: { GITHUB_TOKEN: options.token },
  })
  return (stdout || latestTag || '').replace(/^v/, '')
}

async function getCiScopedCommitShas(latestTag?: string) {
  const logRange = latestTag ? `${latestTag}..HEAD` : 'HEAD'
  const { stdout } = await execa('git', ['log', '--format=%H%x00%s', logRange])

  return stdout.split('\n').flatMap(line => {
    const separator = line.indexOf('\0')
    if (separator === -1) {
      return []
    }

    const sha = line.slice(0, separator)
    const subject = line.slice(separator + 1)
    return /^[a-z]+\(ci\)!?:/.test(subject) ? [sha] : []
  })
}

async function getLatestReleaseTag() {
  const { stdout } = await execa(
    'git',
    [
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      'v[0-9]*',
      '--exclude',
      '*alpha*',
      '--exclude',
      '*beta*',
      '--exclude',
      '*rc*',
    ],
    {
      reject: false,
    },
  )

  return stdout || undefined
}
