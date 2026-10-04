def eval_curls(shoulder, wrist):
    correct_form = False
    reps = 0
    if wrist[1] <= shoulder[1] + 0.1 and wrist[1] >= shoulder[1] - 0.1:
        correct_form = True
        reps +=1
        return reps,correct_form
    else:
        return reps,correct_form

reps, correct_form = eval_curls((0.69, 0.67), (0.76,0.76))

print(reps, correct_form)