const path = require('path');
const dotenv = require('dotenv');
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const { Queue } = require('bullmq');

async function main() {
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  console.log('Connecting to Redis via ioredis...');

  // Get all keys matching pr-analysis
  const keys = await redis.keys('*pr-analysis*');
  console.log('Redis keys matching *pr-analysis*:', keys);

  // Get active jobs list in BullMQ structure
  // BullMQ uses hashes and sets. Let's get the active jobs from the active zset/list.
  // In BullMQ 5, the active list can be retrieved. Or we can just use BullMQ Queue but without the client.get call.
  const { Queue } = require('bullmq');
  const connection = {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  };
  const prAnalysisQueue = new Queue('pr-analysis', { connection });
  
  const waitingJobs = await prAnalysisQueue.getWaiting();
  const activeJobs = await prAnalysisQueue.getActive();
  const failedJobs = await prAnalysisQueue.getFailed();

  console.log('Waiting jobs count:', waitingJobs.length);
  console.log('Active jobs count:', activeJobs.length);
  for (const j of activeJobs) {
    const lockKey = `bull:pr-analysis:${j.id}:lock`;
    const lockVal = await redis.get(lockKey);
    const lockTtl = await redis.ttl(lockKey);
    console.log(`- Job ${j.id}: PR run ${j.data.prRunId}, PR #${j.data.prNumber}`);
    console.log(`  Processed at: ${j.processedOn ? new Date(j.processedOn).toISOString() : 'N/A'}`);
    console.log(`  Lock exists: ${!!lockVal} (value: ${lockVal}, TTL: ${lockTtl}s)`);
    console.log(`  Progress: ${j.progress}`);
  }

  console.log('\nFetching connected Redis clients...');
  const clients = await redis.client('list');
  console.log(clients);

  await prAnalysisQueue.close();
  await redis.disconnect();
}

main()
  .catch((e) => {
    console.error('Error querying Redis:', e);
  });
