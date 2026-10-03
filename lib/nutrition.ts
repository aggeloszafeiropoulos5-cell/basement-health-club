export const nutritionDays=["Δευτέρα","Τρίτη","Τετάρτη","Πέμπτη","Παρασκευή","Σάββατο","Κυριακή"];
export type Meal={name:string;time:string;food:string;quantity:string;alternative:string;kcal:string;protein:string;carbs:string;fat:string};
export type NutritionContent={goal:string;preferences:string;notes:string;days:Meal[][]};
export type NutritionPlan={id:string;member_id:string;title:string;starts_on:string;ends_on:string|null;status:"draft"|"published"|"archived";content:NutritionContent;revision:number;updated_at:string};
export const newMeal=(name="Γεύμα"):Meal=>({name,time:"",food:"",quantity:"",alternative:"",kcal:"",protein:"",carbs:"",fat:""});
export const newNutrition=():NutritionContent=>({goal:"",preferences:"",notes:"",days:nutritionDays.map(()=>[newMeal("Πρωινό"),newMeal("Μεσημεριανό"),newMeal("Βραδινό")])});
export function mealTotals(meals:Meal[]){return ["kcal","protein","carbs","fat"].map(key=>meals.reduce((sum,meal)=>sum+(Number(meal[key as keyof Meal])||0),0));}
export function nutritionError(title:string,start:string,end:string,content:NutritionContent,publish:boolean){
 if(!title.trim())return "Συμπλήρωσε τίτλο πλάνου.";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||end&&end<start)return "Έλεγξε τις ημερομηνίες έναρξης και λήξης.";
 if(content.days.length!==7||content.days.some(day=>day.length>20))return "Επιτρέπονται έως 20 γεύματα ανά ημέρα.";
 for(const day of content.days)for(const meal of day){
  if([meal.kcal,meal.protein,meal.carbs,meal.fat].some(n=>n!==""&&(!Number.isFinite(Number(n))||Number(n)<0||Number(n)>100000)))return "Οι διατροφικές τιμές πρέπει να είναι μη αρνητικοί αριθμοί.";
 }
 if(publish&&!content.days.some(day=>day.some(meal=>meal.food.trim())))return "Πρόσθεσε τρόφιμα πριν δημοσιεύσεις το πλάνο.";
 return "";
}
