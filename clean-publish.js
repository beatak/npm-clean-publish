#!/usr/bin/env node

'use strict';

var fs = require('fs');
var path = require('path');
var readline = require('readline');

var sh = require('shelljs');
var ignore = require('ignore');

var CWD = process.cwd();
var SH_EXEC_OPT = {silent: true};
var RE_DOTFILES = /(^\.|\/\.)/;

var list_find = [];
var list_git = [];
var list_gitignore = [];
var list_npmignore = [];
var list_unregisterd = [];
var exists_npmignore = false;
var global_rl;

var init = function () {
    var npm_config;
    try {
        npm_config = JSON.parse(process.env.npm_config_argv);
    }
    catch (er) {
        // this means probably don't do anything is the best thing
        process.exit(0);
    }
    if (false && -1 === npm_config.original.indexOf('publish')) {
        // this means this is not invoked by publish command, so go ahead!
        process.exit(0);
    }

    process_ignores();
    make_find_list();
};

var process_ignores = function () {
    var path_gitignore = path.join(CWD, '.gitignore');
    var path_npmignore = path.join(CWD, '.npmignore');

    if (fs.existsSync(path_gitignore)) {
        list_gitignore = process_ignore(path_gitignore);
    }
    if (fs.existsSync(path_npmignore)) {
        list_npmignore = process_ignore(path_npmignore);
        exists_npmignore = true;
    }
};

var process_ignore = function (mypath) {
    var result = [];
    fs.readFileSync(mypath).toString().trim().split('\n').forEach(function (line) {
        var idx = line.indexOf('#');
        if (-1 !== idx) {
            line = line.substring(0, idx);
        }
        line = line.trim();
        if (line.length) {
            result.push(line);
        }
    });
    return result;
};

var make_find_list = function () {
    sh.exec(
        ['find ', CWD, ' -type f'].join(''),
        SH_EXEC_OPT,
        function (exit_code, output) {
            var inst_ignore;
            var cwd_len = CWD.length;
            if (0 !== exit_code) {
                console.error('Command `find` failed');
                process.exit(exit_code);
            }
            output.trim().split('\n').forEach(function (each) {
                var line = each.substring(cwd_len + 1);
                if (RE_DOTFILES.test(line)) {
                    return;
                }
                list_find.push(line);
            });
            if (list_gitignore.length) {
                inst_ignore = ignore({ignore: list_gitignore});
                list_find = list_find.filter(inst_ignore.createFilter());
            }            
            make_git_list();
        }
    );
};

var make_git_list = function () {
    sh.exec(
        ['cd ', CWD, '&& git ls-tree --full-tree -r HEAD'].join(''),
        SH_EXEC_OPT,
        function (exit_code, output) {
            if (0 !== exit_code) {
                console.error('Command `git ls-tree` failed');
                process.exit(exit_code);
            }
            output.trim().split('\n').forEach(function (each) {
                list_git.push(each.split('\t')[1]);
            });
            compare_list();
        }
    );
};

var compare_list = function () {
    var obj = {};

    list_git.forEach(function (elm) {
        obj[elm] = true;
    });
    list_find.forEach(function (elm) {
        if (!obj[elm]) {
            list_unregisterd.push(elm);
        }
    });

    conclude();
};

var conclude = function () {
    var inst_npm_ignore, filtered, rl;
    if (0 === list_unregisterd.length) {
        console.error('PASSED!');
        process.exit(1);
    }
    if (exists_npmignore) {
        inst_npm_ignore = ignore({ignore: list_npmignore});
        filtered = list_unregisterd.filter(inst_npm_ignore.createFilter());
        // list_find = list_find.filter(inst_ignore.createFilter());
        if (0 === filtered.length) {
            console.error('PASSED!');
            process.exit(1);
        }
    }

    global_rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    global_q_pointer = Q_DONT_PUBLISH;
    rl_iterate(null);
};

var rl_iterate = function (answer) {
    // console.error('POINTER: ' + global_q_pointer);
    var result, choices = {}, opt = {}, type_result;
    if (null !== answer && undefined !== answer) {
        answer = answer.toLowerCase();
        result = global_questions_map[global_q_pointer];
        // if ('number' === typeof result) {
        //     process.exit(result);
        // }
        Object.keys(result).forEach(function (key) {
            key.split(',').forEach(function (choice) {
                choices[choice.toLowerCase()] = result[key];
            });
        });
        // console.error(JSON.stringify(
        //     [choices, answer], '\n', 2
        // ));
        if (undefined === choices[answer]) {
            opt.pardon_me = true;
        }
        else {
            global_q_pointer = choices[answer];
        }
    }
    if (global_q_pointer === Q_IGNORE) {
        if (exists_npmignore) {
            global_q_pointer = Q_IGNORE_EXISTS;
        }
        else {
            global_q_pointer = Q_CREATING_IGNORE;
        }
        // console.error('next up: ' + global_q_pointer);
        setTimeout(
            function () {
                rl_iterate();
            },
            10
        );
        return;
    }
    type_result = typeof global_questions_map[global_q_pointer];
    if ('number' === type_result) {
        console.error(mycopy(global_q_pointer));
        process.exit(global_questions_map[global_q_pointer]);
    }
    else if ('function' === type_result) {
        console.error(mycopy(global_q_pointer));
        global_questions_map[global_q_pointer]();
    }
    else {
        global_rl.question(
            mycopy(global_q_pointer, opt),
            rl_iterate
        );
    }
};

var global_q_pointer;
var Q_DONT_PUBLISH = '0';
var Q_OKAY_MYBAD = '1';
var Q_HOW_DEAL = '2';
var Q_ABORT = '3';
var Q_DELETE = '4';
var Q_IGNORE = '5';
var Q_OKAY = '6';
var Q_CREATING_IGNORE = '7';
var Q_IGNORE_EXISTS = '8';
var Q_MERGE = '9';
var Q_KEEP_ONCE = '10';

var global_questions_map = {};

var mycopy = function (key, opt) {
    var result = [], tmp, pardon_me;
    opt = opt || {};
    pardon_me = opt.pardon_me;
    switch (key) {
    case Q_DONT_PUBLISH:
        tmp = list_unregisterd.length;
        if (tmp === 1) {
            result.push(' I found a file that is not checked-in to the repository:');
        }
        else {
            result.push(' I found ' + tmp + ' files that are not checked-in to this repository:');
        }
        list_unregisterd.forEach(function (line) {
            result.push('  - ' + line);
        });
        result.push('');
        if (tmp === 1) {
            result.push(' Are you sure you want to publish this? (y/n)');
        }
        else {
            result.push(' Are you sure you want to publish these? (y/n)');
        }
        result.push('');
        break;

    case Q_OKAY_MYBAD:
        result.push(' Okay, my bad.');
        break;

    case Q_HOW_DEAL:
        result.push(' How do you wanna deal with it? (d: delete, i: use npmignore, s: stop publishing)');
        break;

    case Q_ABORT:
        result.push(' Okay, stopping');
        break;

    case Q_DELETE:
        tmp = list_unregisterd.length;
        if (1 === tmp) {
            result.push(' The file will be lost forever. Are you sure about that? (y/n)');
        }
        else {
            result.push(' The files will be lost forever. Are you sure about that? (y/n)');
        }
        break;

    case Q_IGNORE:
        // neeed more logic here
        break;

    case Q_OKAY:
        result.push(' Okay.');
        break;

    case Q_CREATING_IGNORE:
        result.push(' Creating .npmignore now.');
        break;

    case Q_IGNORE_EXISTS:
        result.push(' .npmignore exists already. What do you wanna do? (m:merge, k: keep original and override this time, o: override forever)');
        break;

    }
    result = result.join('\n') + ' ';
    if (pardon_me) {
        result = '\n Sorry I didn\'t get that.' + result;
    }
    return result;
};

var onend = function () {
    process.exit(1);
};

var onend_creating_ignore = function () {
    console.log('ohhhhhhhhhh yeahhhh');
    onend();
};

var onend_ignore_once = function () {
    console.log('oohh ignore once');
    onend();
};

var onend_merge = function () {
    console.log('oohh merge');
    onend();
};

(function () {
    // 0
    global_questions_map[Q_DONT_PUBLISH] = {
        'y,yes': Q_OKAY_MYBAD,
        'n,no': Q_HOW_DEAL
    };

    // 1
    global_questions_map[Q_OKAY_MYBAD] = 0;

    // 2
    global_questions_map[Q_HOW_DEAL] = {
        'd,delete': Q_DELETE,
        'i,ignore': Q_IGNORE,
        's,stop': Q_ABORT
    };

    // 3
    global_questions_map[Q_ABORT] = 1;

    // 4
    global_questions_map[Q_DELETE] = {
        'n,no': Q_ABORT,
        'y,yes': Q_OKAY
    };

    // 5
    global_questions_map[Q_IGNORE] = 1;
 
    // 6
    global_questions_map[Q_OKAY] = 0;

    // Q_CREATING_IGNORE = '7';
    global_questions_map[Q_CREATING_IGNORE] = onend_creating_ignore;

    // Q_IGNORE_EXISTS = '8';
    global_questions_map[Q_IGNORE_EXISTS] = {
        'm,merge': Q_MERGE,
        'k,keep,once': Q_KEEP_ONCE,
        'o,override': Q_CREATING_IGNORE
    };

    // Q_MERGE = '9';
    global_questions_map[Q_MERGE] = onend_merge;
 
    // Q_KEEP_ONCE = '10';
    global_questions_map[Q_KEEP_ONCE] = onend_ignore_once;
})();

init();
