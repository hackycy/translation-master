#!/usr/bin/env node
import { Command } from 'commander'
import pc from 'picocolors'
import { version } from '../package.json'

const program = new Command()

program
  .name('tmigrate')
  .description('Extract Chinese text from source files and manage i18n migration maps.')
  .version(version)

program
  .command('init')
  .description('Create the .tmigrate directory structure and default configuration.')
  .option('-i, --interactive', 'prompt for configuration values')
  .option('--from <locale>', 'source locale')
  .option('--to <locale>', 'target locale')
  .option('--no-overwrite', 'preserve existing files')
  .action(() => {
    console.log(pc.yellow('tmigrate init is not implemented yet.'))
  })

program
  .command('scan [path]')
  .description('Scan source files and write split map files under .tmigrate/maps.')
  .option('--to <locale>', 'target locale')
  .option('--incremental', 'scan only changed files')
  .option('--clean-deprecated', 'remove deprecated entries from map files')
  .action(() => {
    console.log(pc.yellow('tmigrate scan is not implemented yet.'))
  })

program
  .command('apply')
  .description('Apply approved translations back to source files.')
  .option('--dry-run', 'print a diff without writing files')
  .option('--path <path>', 'limit apply to a file or directory')
  .action(() => {
    console.log(pc.yellow('tmigrate apply is not implemented yet.'))
  })

program
  .command('restore')
  .description('Restore files from .tmigrate/backups.')
  .option('--path <path>', 'restore a specific file')
  .option('--list', 'list available backups')
  .action(() => {
    console.log(pc.yellow('tmigrate restore is not implemented yet.'))
  })

program.parse()
