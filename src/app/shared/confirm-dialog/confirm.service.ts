import { inject, Service } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, ConfirmOptions } from './confirm-dialog';

@Service()
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  /** Opens a confirmation dialog. Resolves to true only if the user confirmed. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmOptions, boolean>(ConfirmDialog, {
      data: options,
      width: '28rem',
      maxWidth: '90vw',
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
