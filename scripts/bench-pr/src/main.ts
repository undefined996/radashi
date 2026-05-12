import fs from 'node:fs/promises'
import path from 'node:path'

main().catch(error => {
  console.error(error)
  process.exit(1)
})

async function main() {
  if (process.argv[2] === 'comment') {
    await commentOnPullRequest(process.argv.slice(3))
    return
  }

  const { baseRef, prNumber, prBlobURL } = parseArgv(process.argv.slice(2))
  const [{ benchAddedFiles }, { benchChangedFiles }, { execa }] =
    await Promise.all([
      import('@radashi-org/benchmarks/benchAddedFiles.ts'),
      import('@radashi-org/benchmarks/benchChangedFiles.ts'),
      import('execa'),
    ])

  // Run the benchmarks
  const addedFiles = await benchAddedFiles()
  const changedFiles = await benchChangedFiles(baseRef)

  console.log('Added', addedFiles)
  console.log('Changed', changedFiles)

  if (addedFiles.length === 0 && changedFiles.length === 0) {
    console.log('No benchmarks were found')
    await writeBenchmarkOutput('')
    return
  }

  const baseSHA = await execa('git', ['rev-parse', 'HEAD']).then(r => r.stdout)

  const columnNames = ['Name', 'Current']
  if (changedFiles.some(b => b.baseline)) {
    columnNames.push('Baseline', 'Change')
  }

  // Create the comment body
  let commentBody = '## Benchmark Results\n\n'
  commentBody += `| ${columnNames.join(' | ')} |\n`
  commentBody += `| ${columnNames.map(name => '-'.repeat(name.length)).join(' | ')} |\n`

  for (const report of changedFiles) {
    if (Number.isNaN(report.benchmark.hz)) {
      console.error('Invalid benchmark', report)
      continue
    }

    if (!report.baseline) {
      addedFiles.push(report)
      continue
    }

    const { file, location, benchmark, baseline } = report

    const benchBlobURL =
      `${prBlobURL}/${file}` + (location ? `#L${location.line}` : '')

    const srcFile = file
      .replace('benchmarks', 'src')
      .replace(/\.bench\.ts$/, '.ts')

    const change = ((benchmark.hz - baseline.hz) / baseline.hz) * 100
    const columns = [
      `[${benchmark.func} ▶︎ ${benchmark.name}](${benchBlobURL})`,
      `${formatNumber(benchmark.hz)} ops/sec ±${formatNumber(benchmark.rme)}%`,
      `${formatNumber(baseline.hz)} ops/sec ±${formatNumber(baseline.rme)}% [🔗](https://github.com/radashi-org/radashi/blob/${baseSHA}/${srcFile})`,
      formatChange(change),
    ]

    commentBody += `| ${columns.join(' | ')} |\n`
  }

  for (const report of addedFiles) {
    if (Number.isNaN(report.benchmark.hz)) {
      console.error('Invalid benchmark', report)
      continue
    }

    const { file, location, benchmark } = report
    const benchURL =
      `${prBlobURL}/${file}` + (location ? `#L${location.line}` : '')

    const columns = [
      `[${benchmark.func}: ${benchmark.name}](${benchURL})`,
      `${formatNumber(benchmark.hz)} ops/sec ±${formatNumber(benchmark.rme)}%`,
    ]

    if (columnNames.length > 2) {
      columns.push('', '')
    }

    commentBody += `| ${columns.join(' | ')} |\n`
  }

  commentBody +=
    "\n*Performance regressions of 30% or more should be investigated, unless they were anticipated. Smaller regressions may be due to normal variability, as we don't use dedicated CI infrastructure.*"

  const radashiBotToken = process.env.RADASHI_BOT_TOKEN
  if (!radashiBotToken) {
    await writeBenchmarkOutput(commentBody)
    return
  }

  await postBenchmarkComment({
    prNumber,
    commentBody,
    radashiBotToken,
  })
}

async function commentOnPullRequest(argv: string[]) {
  const [prNumber, commentPath] = argv
  if (!prNumber || Number.isNaN(+prNumber) || !commentPath) {
    throw new Error('Expected arguments: comment <pr-number> <comment-path>')
  }

  const commentBody = await fs.readFile(commentPath, 'utf8')
  if (!commentBody.trim()) {
    console.log('No benchmark results were produced')
    return
  }

  const radashiBotToken = process.env.RADASHI_BOT_TOKEN
  if (!radashiBotToken) {
    throw new Error(
      'RADASHI_BOT_TOKEN is required to comment on benchmark results',
    )
  }

  await postBenchmarkComment({
    prNumber: +prNumber,
    commentBody,
    radashiBotToken,
  })
}

async function postBenchmarkComment({
  prNumber,
  commentBody,
  radashiBotToken,
}: {
  prNumber: number
  commentBody: string
  radashiBotToken: string
}) {
  const { Octokit } = await import('@octokit/rest')
  const octokit = new Octokit({
    auth: radashiBotToken,
  })

  // Find and update the existing benchmark comment if it exists, or create a new one
  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: 'radashi-org',
      repo: 'radashi',
      issue_number: prNumber,
      per_page: 100,
    })

    const existingCommentIndex = comments.findIndex(
      comment =>
        comment.body?.startsWith('## Benchmark Results') &&
        comment.user?.login === 'radashi-bot',
    )

    if (
      existingCommentIndex !== -1 &&
      existingCommentIndex === comments.length - 1
    ) {
      const existingComment = comments[existingCommentIndex]
      await octokit.rest.issues.updateComment({
        owner: 'radashi-org',
        repo: 'radashi',
        comment_id: existingComment.id,
        body: commentBody,
      })
      console.log(
        'Successfully updated existing benchmark comment:',
        existingComment.html_url,
      )
    } else {
      // If the existing comment is not the last one, replace it with a new one.
      if (existingCommentIndex !== -1) {
        const existingComment = comments[existingCommentIndex]
        await octokit.rest.issues.deleteComment({
          owner: 'radashi-org',
          repo: 'radashi',
          comment_id: existingComment.id,
        })
      }

      const { data: newComment } = await octokit.rest.issues.createComment({
        owner: 'radashi-org',
        repo: 'radashi',
        issue_number: prNumber,
        body: commentBody,
      })
      console.log(
        'Successfully created new benchmark comment:',
        newComment.html_url,
      )
    }
  } catch (error: any) {
    error.message = `Failed to update or create comment in PR: ${error.message}`
    throw error
  }
}

function formatNumber(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

function formatChange(change: number) {
  return `${change >= 0 ? '🚀' : '🐢'} ${change >= 0 ? '+' : ''}${formatNumber(change)}%`
}

async function writeBenchmarkOutput(markdown: string) {
  const commentPath = process.env.BENCHMARK_COMMENT_PATH
  if (commentPath) {
    await fs.mkdir(path.dirname(commentPath), { recursive: true })
    await fs.writeFile(commentPath, markdown)
    console.log('Benchmark results written to', commentPath)
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) {
    if (markdown) {
      console.log(markdown)
    }
    return
  }

  if (markdown) {
    await fs.appendFile(summaryPath, markdown + '\n')
    console.log('Benchmark results written to job summary')
  }
}

function parseArgv(argv: string[]) {
  const [baseRef, prNumber, prBlobURL] = argv
  if (!baseRef || Number.isNaN(+prNumber) || !URL.canParse(prBlobURL)) {
    throw new Error(`Invalid arguments: ${argv.join(' ')}`)
  }

  return {
    baseRef,
    prNumber: +prNumber,
    prBlobURL,
  }
}
