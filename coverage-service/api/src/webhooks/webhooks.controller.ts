import { createHmac, timingSafeEqual } from 'crypto';

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('github')
  @HttpCode(200)
  async handleGitHub(
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
    @Body() payload: Record<string, unknown>,
  ) {
    this.verifySignature(JSON.stringify(payload), signature);

    if (event === 'pull_request') {
      return this.webhooksService.handlePullRequest(payload);
    }

    // GitHub App installation events — fired when someone installs/uninstalls
    // the app or grants/revokes access to individual repos.
    if (event === 'installation' || event === 'installation_repositories') {
      return this.webhooksService.handleInstallation(payload);
    }

    return { received: true, event };
  }

  private verifySignature(body: string, signature?: string) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) return;

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const expected =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expected);

    if (
      sigBuffer.length !== expBuffer.length ||
      !timingSafeEqual(sigBuffer, expBuffer)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
