/** Both upload surfaces follow the durable job instead of mistaking HTTP 202 for completion. */
export async function waitForExtraction(response, onProgress = () => {}) {
  const accepted = await response.json();
  if (!response.ok || !accepted.success) throw new Error(accepted.error || 'Extraction could not start');
  if (!accepted.jobId) return accepted;
  while (true) {
    const status = await fetch(accepted.statusUrl);
    if (!status.ok) throw new Error('Cannot read extraction status; the job continues on the server');
    const {job} = await status.json();
    onProgress(job.status, job.progress);
    if (['failed', 'interrupted'].includes(job.status)) throw new Error(job.error || 'Extraction interrupted; retry to resume');
    if (['completed', 'partial'].includes(job.status)) return {
      success: true, ...job.result, partial: job.status === 'partial',
    };
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
